import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const userId = auth.session.userId
  const plan = auth.user.currentPlanId
    ? await db.plan.findUnique({ where: { id: auth.user.currentPlanId } })
    : await db.plan.findUnique({ where: { id: 'plan_free' } })

  const monthKey = new Date().toISOString().slice(0, 7)
  const counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId, monthKey } } })
  const usedPins = counter?.publishedCount || 0
  const monthlyQuota = plan?.monthlyPinQuota || 10

  const [connectedAccounts, activeSchedules, failedJobs] = await Promise.all([
    db.pinterestConnection.count({ where: { userId, status: 'active' } }),
    db.scheduledPin.count({ where: { userId, status: { in: ['queued', 'publishing'] } } }),
    db.scheduledPin.count({ where: { userId, status: { in: ['failed_final', 'retry_waiting'] } } }),
  ])

  return NextResponse.json({
    currentPlan: plan,
    monthlyQuota,
    usedPinsThisMonth: usedPins,
    remainingPins: Math.max(0, monthlyQuota - usedPins),
    connectedAccounts,
    accountLimit: plan?.maxConnectedAccounts || 1,
    dailyPinLimit: plan?.dailyPinLimit || 10,
    activeSchedules,
    failedJobs,
  })
}