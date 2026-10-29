import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { parsePagination } from '@/lib/pagination'
import { computeNewExpiry } from '@/lib/subscription'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { status } = Object.fromEntries(req.nextUrl.searchParams)
  const { page, limit, skip } = parsePagination(req.nextUrl.searchParams)
  const where: any = {}
  if (status) where.status = status

  const [orders, total] = await Promise.all([
    db.paymentOrder.findMany({
      where,
      include: { user: { select: { email: true, name: true, status: true } }, plan: { select: { name: true, priceUsd: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.paymentOrder.count({ where }),
  ])
  return NextResponse.json({ orders, total, page, limit })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { orderId, action, adminNotes } = payload
  if (!orderId || !action) return NextResponse.json({ error: 'orderId and action required' }, { status: 400 })
  if (action !== 'verify' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "verify" or "reject"' }, { status: 400 })
  }

  const order = await db.paymentOrder.findUnique({ where: { id: orderId }, include: { user: true, plan: true } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // An order the user is mid-verification on (auto TRC20 flow) must not be flipped underneath it,
  // and an order that was never paid for (no TXID submitted) must not be activated by a misclick.
  if (order.status === 'verifying') {
    return NextResponse.json({ error: 'This order is being verified automatically right now. Try again in a minute.' }, { status: 409 })
  }
  if (action === 'verify' && !order.txid) {
    return NextResponse.json({ error: 'No TXID was submitted for this order — nothing to verify.' }, { status: 400 })
  }
  if (action === 'verify' && order.status === 'rejected') {
    return NextResponse.json({ error: 'This order was rejected. Ask the user to create a new order instead of re-verifying it.' }, { status: 409 })
  }

  let update: any = { reviewedByAdminId: auth.session!.userId, reviewedAt: new Date(), adminNotes: adminNotes || null }
  if (action === 'verify') {
    update.status = 'verified'
    // Activate plan for user
    await db.user.update({ where: { id: order.userId }, data: { currentPlanId: order.planId, status: 'active', approvedAt: new Date() } })
    // Only a first-time verification adds days (re-verifying the same order must not extend again)
    const existingSub = await db.subscription.findUnique({ where: { id: `sub_${order.id}` } })
    if (!existingSub) {
      await db.subscription.create({
        data: { id: `sub_${order.id}`, userId: order.userId, planId: order.planId, status: 'active', expiresAt: await computeNewExpiry(order.userId) },
      })
    } else {
      await db.subscription.update({ where: { id: existingSub.id }, data: { status: 'active' } })
    }
  } else if (action === 'reject') {
    update.status = 'rejected'
  }

  const updated = await db.paymentOrder.update({ where: { id: orderId }, data: update })
  await db.auditLog.create({
    data: { actorType: 'admin', actorId: auth.session!.userId, entityType: 'payment_order', entityId: orderId, action: `admin_${action}_payment`, metadataJson: JSON.stringify({ orderId, action }) },
  })
  return NextResponse.json({ order: updated })
}
