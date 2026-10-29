import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getSubscriptionState, PLAN_DURATION_DAYS } from '@/lib/subscription'

/**
 * GET /api/subscription
 * Returns the logged-in user's plan expiry state:
 * { enforced, active, expiresAt, daysLeft, planName, durationDays }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const state = await getSubscriptionState(auth.user)
  return NextResponse.json({ ...state, durationDays: PLAN_DURATION_DAYS })
}
