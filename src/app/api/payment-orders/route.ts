import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { config } from '@/lib/config'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const orders = await db.paymentOrder.findMany({
    where: { userId: auth.session.userId },
    include: { plan: { select: { name: true, priceUsd: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ orders })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { planId, txid, paymentMethod } = await req.json()
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })

  const method = paymentMethod === 'binance' ? 'binance' : 'trc20'

  // Server-computed expectedPrice from plan
  const plan = await db.plan.findUnique({ where: { id: planId } })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (!plan.priceUsd || plan.priceUsd <= 0) {
    return NextResponse.json({ error: 'This plan is free or has no price' }, { status: 400 })
  }

  const serverExpectedPrice = plan.priceUsd
  const walletAddress = method === 'binance'
    ? config.binancePayId
    : config.tronWalletAddress

  if (!walletAddress) {
    return NextResponse.json({ error: `Payment method ${method} is not configured. Please contact support.` }, { status: 400 })
  }

  // For Binance Pay: manual verification, status = submitted
  // For TRC20: auto-verification flow, status = submitted if txid provided
  const order = await db.paymentOrder.create({
    data: {
      userId: auth.session.userId,
      planId,
      amount: 0,
      expectedAmount: serverExpectedPrice,
      network: method === 'binance' ? 'Binance' : 'TRC20',
      walletAddress,
      txid: txid || null,
      status: txid ? 'submitted' : 'pending',
    },
    include: { plan: { select: { name: true, priceUsd: true } } },
  })
  return NextResponse.json({ order, expectedAmount: serverExpectedPrice, paymentMethod: method })
}
