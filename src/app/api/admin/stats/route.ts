import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const [totalUsers, activeUsers, pendingUsers, suspendedUsers, totalConnections, totalPins, publishedPins, failedPins, totalRevenue, pendingPayments] = await Promise.all([
    db.user.count({ where: { role: 'user' } }),
    db.user.count({ where: { role: 'user', status: 'active' } }),
    db.user.count({ where: { role: 'user', status: 'pending' } }),
    db.user.count({ where: { status: 'suspended' } }),
    // Active connections only — disconnected (soft-deleted) accounts are
    // kept in the DB for history/limit tracking and shouldn't inflate this.
    db.pinterestConnection.count({ where: { status: { not: 'disconnected' } } }),
    db.scheduledPin.count(),
    db.scheduledPin.count({ where: { status: 'published' } }),
    db.scheduledPin.count({ where: { status: { in: ['failed_final', 'retry_waiting'] } } }),
    db.paymentOrder.aggregate({ where: { status: 'verified' }, _sum: { amount: true } }),
    db.paymentOrder.count({ where: { status: { in: ['pending', 'submitted'] } } }),
  ])

  return NextResponse.json({
    totalUsers, activeUsers, pendingUsers, suspendedUsers,
    totalConnections, totalPins, publishedPins, failedPins,
    totalRevenue: totalRevenue._sum.amount || 0,
    pendingPayments,
  })
}