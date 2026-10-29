import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { config } from '@/lib/config'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { trackPaymentVerified, trackPlanUpgraded } from '@/lib/analytics'
import { computeNewExpiry } from '@/lib/subscription'
import { parseTronscanInfo, parseNodeTransaction } from '@/lib/tron'

const TRON_WALLET = () => config.tronWalletAddress
const TRONSCAN_API_KEY = () => config.tronscanApiKey

// USDT TRC20 contract address on Tron
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

interface VerifyTxResult {
  success: boolean
  amount?: number
  from?: string
  to?: string
  timestamp?: number
  error?: string
}

const TRONGRID_SOLIDITY_URL = 'https://api.trongrid.io/walletsolidity/gettransactionbyid'

async function verifyTronscanTx(txid: string): Promise<VerifyTxResult> {
  const wallet = TRON_WALLET()
  if (!wallet) return { success: false, error: 'Payment wallet is not configured. Please contact support.' }

  // Method 1: Tronscan API with API key
  let tronscanError: string | undefined
  if (TRONSCAN_API_KEY()) {
    try {
      const res = await fetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${txid}`, {
        headers: { 'TRON-PRO-API-KEY': TRONSCAN_API_KEY() },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const parsed = parseTronscanInfo(await res.json(), wallet, USDT_CONTRACT)
        if (parsed.success) return parsed
        tronscanError = parsed.error // maybe not indexed yet — try the node API below
      }
    } catch {}
  }

  // Method 2: TronGrid solidity node (CONFIRMED transactions only; returns {} while
  // unconfirmed / unknown). The previous fallback looked up the recipient in a field that
  // does not exist on TRC20 calls and used a wrong Base58 checksum, so it rejected every
  // payment — the recipient and amount are now decoded from the transfer() call data.
  try {
    const res = await fetch(TRONGRID_SOLIDITY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ value: txid }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      return parseNodeTransaction(await res.json(), wallet, USDT_CONTRACT)
    }
    const errText = await res.text().catch(() => '')
    // SECURITY: Don't pass external API error messages straight to the client.
    console.error('[payment-verify] TronGrid API error:', res.status, errText.slice(0, 300))
    return { success: false, error: tronscanError || 'Unable to verify transaction on the blockchain. Please try again in a few minutes.' }
  } catch (err) {
    console.error('[payment-verify] verifyTronscanTx crashed:', err instanceof Error ? err.message : err)
    return { success: false, error: tronscanError || 'Failed to verify transaction. Please try again.' }
  }
}

// An order stuck in 'verifying' (process crashed / DB error mid-verification) must not be locked
// forever: after this long it may be retried, and its TXID stops blocking other orders.
const VERIFYING_STALE_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Rate limit: 10 verify attempts per minute per IP (prevents TXID brute-force
  // and DoS on the Tronscan/TronGrid APIs)
  const ip = getClientIp(req)
  const rl = checkRateLimit(`payment-verify:${ip}`, 10, 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many verification attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  let orderId: unknown
  try {
    ;({ orderId } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!orderId || typeof orderId !== 'string') return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const order = await db.paymentOrder.findUnique({
    where: { id: orderId },
    include: { plan: true, user: true },
  })

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.userId !== auth.session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!order.txid) return NextResponse.json({ error: 'No TXID submitted' }, { status: 400 })

  const txid = order.txid.trim()

  // ── Binance Pay: manual verification ──
  // Handled BEFORE the Tron TXID format check: Binance Pay references are not 64-char hex
  // Tron hashes, so the hex check below used to reject every legitimate Binance submission.
  if (order.network === 'Binance') {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(txid)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid Binance Pay reference. Paste the Order ID / transaction ID from your Binance Pay receipt.',
        orderStatus: order.status,
      }, { status: 400 })
    }
    // Never downgrade an order an admin already decided on
    if (order.status === 'verified' || order.status === 'rejected') {
      return NextResponse.json({ success: false, error: `This order is already ${order.status}.`, orderStatus: order.status })
    }
    await db.paymentOrder.update({
      where: { id: orderId },
      data: { status: 'submitted' },
    })
    return NextResponse.json({
      success: true,
      message: `Binance Pay payment submitted! Your transaction (ref: ${txid}) will be reviewed by our team within 24 hours. You'll be notified once verified.`,
      orderStatus: 'submitted',
    })
  }

  // SECURITY: Validate TXID format before hitting external APIs
  // Tron mainnet transaction hashes are 64-character hexadecimal strings
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
    await db.paymentOrder.update({
      where: { id: orderId },
      data: { status: 'failed_verification', verifyError: 'Invalid transaction ID format' },
    })
    return NextResponse.json({
      success: false,
      error: 'Invalid transaction ID format. A valid Tron TXID is 64 hexadecimal characters.',
      orderStatus: 'failed_verification',
    }, { status: 400 })
  }

  // ── TRC20: auto-verify on blockchain ──
  // SECURITY: Atomic status transition → verifying. Only ONE of two simultaneous requests can
  // flip the row, which prevents double-activation. A row stuck in 'verifying' for longer than
  // VERIFYING_STALE_MS (crash mid-verification) may be taken over again.
  const staleBefore = new Date(Date.now() - VERIFYING_STALE_MS)
  const conditionalUpdate = await db.paymentOrder.updateMany({
    where: {
      id: orderId,
      OR: [
        { status: { in: ['submitted', 'pending', 'failed_verification'] } },
        { status: 'verifying', updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: 'verifying' },
  })
  if (conditionalUpdate.count === 0) {
    // Order is already being verified or has been verified — reject
    const currentOrder = await db.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true } })
    return NextResponse.json({
      success: false,
      error: `This order is already being processed (status: ${currentOrder?.status || 'unknown'}). Please wait.`,
      orderStatus: currentOrder?.status || 'unknown',
    })
  }

  // From here on the order is 'verifying'. ANY unexpected throw (Tron API, DB, GA4…) must put it
  // back into a retryable state — previously it stayed 'verifying' forever, the user could never
  // retry, and its TXID stayed locked against every other order.
  try {
    return await verifyAndActivate(order, orderId, txid, staleBefore)
  } catch (err) {
    console.error('[payment-verify] Unexpected error while verifying order', orderId, err instanceof Error ? err.message : err)
    await db.paymentOrder.updateMany({
      where: { id: orderId, status: 'verifying' },
      data: { status: 'failed_verification', verifyError: 'Temporary verification error — please try again.' },
    }).catch(() => {})
    return NextResponse.json({
      success: false,
      error: 'Verification hit a temporary error. Please try again in a minute.',
      orderStatus: 'failed_verification',
    }, { status: 502 })
  }
}

// Minimal structural type of the order (+ relations) this flow needs — keeps the helper
// independent of Prisma's generated payload types.
interface VerifiableOrder {
  id: string
  userId: string
  planId: string
  expectedAmount: number
  plan: { name: string }
  user: { email: string; currentPlanId: string | null }
}

async function verifyAndActivate(
  order: VerifiableOrder,
  orderId: string,
  txid: string,
  staleBefore: Date,
) {
  // Pre-check: has this TXID already been used by ANOTHER order?
  // Do this BEFORE hitting the blockchain API to avoid redundant calls and
  // to fail fast on replay attempts. (A stale 'verifying' row no longer blocks the TXID.)
  const alreadyUsed = await db.paymentOrder.findFirst({
    where: {
      txid,
      id: { not: orderId },
      OR: [{ status: 'verified' }, { status: 'verifying', updatedAt: { gte: staleBefore } }],
    },
  })
  if (alreadyUsed) {
    await db.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: 'failed_verification',
        verifyError: 'This TXID has already been used for another payment',
      },
    })
    return NextResponse.json({
      success: false,
      error: 'This transaction ID has already been used for another payment.',
      orderStatus: 'failed_verification',
    })
  }

  const result = await verifyTronscanTx(txid)

  if (!result.success || !result.amount) {
    await db.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: 'failed_verification',
        verifyError: result.error || 'Verification failed',
      },
    })
    return NextResponse.json({
      success: false,
      error: result.error || 'Verification failed',
      orderStatus: 'failed_verification',
    })
  }

  // A TXID is public on-chain, so anyone could submit someone else's (or an old) transfer
  // that has not been claimed yet. Only accept recent payments (default 48h, env
  // PAYMENT_TX_MAX_AGE_HOURS). If the API gave no timestamp we cannot check — allow, but log.
  const maxAgeMs = (parseFloat(process.env.PAYMENT_TX_MAX_AGE_HOURS || '') || 48) * 60 * 60 * 1000
  if (result.timestamp) {
    if (Date.now() - result.timestamp > maxAgeMs) {
      await db.paymentOrder.update({
        where: { id: orderId },
        data: { status: 'failed_verification', verifyError: 'Transaction is too old to be accepted' },
      })
      return NextResponse.json({
        success: false,
        error: 'This transaction is too old to be accepted. Please contact support with your TXID.',
        orderStatus: 'failed_verification',
      })
    }
  } else {
    console.warn(`[payment-verify] No timestamp for tx ${txid} — age check skipped`)
  }

  const expectedAmount = order.expectedAmount
  const actualAmount = result.amount

  if (Math.abs(actualAmount - expectedAmount) > 0.01) {
    await db.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: 'failed_verification',
        amount: actualAmount,
        verifyError: `Amount mismatch: sent ${actualAmount} USDT but expected ${expectedAmount} USDT`,
      },
    })
    return NextResponse.json({
      success: false,
      error: `Payment amount mismatch. You sent ${actualAmount} USDT but the plan requires exactly ${expectedAmount} USDT.`,
      orderStatus: 'failed_verification',
    })
  }

  const existingVerified = await db.paymentOrder.findFirst({
    where: { txid, status: 'verified', id: { not: orderId } },
  })
  if (existingVerified) {
    await db.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: 'failed_verification',
        verifyError: 'This TXID has already been used for another payment',
      },
    })
    return NextResponse.json({
      success: false,
      error: 'This transaction ID has already been used for another payment.',
      orderStatus: 'failed_verification',
    })
  }

  // ALL CHECKS PASSED — activate atomically. Plan, subscription and order status used to be three
  // separate writes: a failure between them left the user with a plan but an order stuck in
  // 'verifying' (or an order marked verified without a subscription).
  const newExpiry = await computeNewExpiry(order.userId)
  const updated = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: order.userId },
      data: { currentPlanId: order.planId, status: 'active', approvedAt: new Date() },
    })
    // Renewal: +30 days, stacked on any days still left (see lib/subscription.ts)
    await tx.subscription.upsert({
      where: { id: `sub_${order.id}` },
      update: { status: 'active', expiresAt: newExpiry },
      create: {
        id: `sub_${order.id}`,
        userId: order.userId,
        planId: order.planId,
        status: 'active',
        expiresAt: newExpiry,
      },
    })
    const o = await tx.paymentOrder.update({
      where: { id: orderId },
      data: { status: 'verified', amount: actualAmount, reviewedAt: new Date(), verifyError: null },
    })
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        entityType: 'payment_order',
        entityId: orderId,
        action: 'auto_verified_payment',
        metadataJson: JSON.stringify({ orderId, txid, expectedAmount, actualAmount, from: result.from }),
      },
    })
    return o
  })

  // ── Google Analytics 4 — server-side revenue tracking ──────────────
  // Non-blocking — if GA4 fails, payment verification still succeeds.
  try {
    await trackPaymentVerified({
      orderId,
      userId: order.userId,
      planName: order.plan.name,
      amount: actualAmount,
      userEmail: order.user.email,
    })

    // Also track plan upgrade event (useful for funnel analysis)
    const previousPlan = order.user.currentPlanId || 'plan_free'
    await trackPlanUpgraded({
      userId: order.userId,
      fromPlan: previousPlan,
      toPlan: order.plan.name,
      amount: actualAmount,
    })
  } catch (gaError: any) {
    // Don't let GA4 failure break payment verification
    console.error('[payment-verify] GA4 tracking failed (non-fatal):', gaError.message)
  }

  return NextResponse.json({
    success: true,
    message: `Payment verified! ${actualAmount} USDT received. Plan "${order.plan.name}" is now active.`,
    order: updated,
  })
}
