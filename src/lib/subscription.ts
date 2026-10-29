import { db } from './db'

// ─── Monthly plan expiry ────────────────────────────────────────────
// A paid plan lasts PLAN_DURATION_DAYS from the payment. The expiry is
// evaluated lazily from the Subscription table (no cron needed): the
// latest `expiresAt` of the user's subscriptions is the source of truth.
//
//  - Free plan, admins, and admin-assigned plans that have NO subscription
//    row are never expired ("enforced: false").
//  - When the date passes, publishing stops (worker pauses the pins with
//    the PLAN_EXPIRED_MARKER message) and creating new pins is blocked.
//  - A renewal payment adds another 30 days (stacked on any days left) and
//    the worker auto-resumes every pin that was paused by the expiry.

export const PLAN_DURATION_DAYS = 30
export const PLAN_DURATION_MS = PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** lastError prefix on pins paused because the plan expired (worker uses the same text). */
export const PLAN_EXPIRED_MARKER = 'Plan expired'

export interface SubscriptionState {
  /** false = nothing to enforce (Free plan / admin / no subscription row) */
  enforced: boolean
  /** true = user may publish / create pins */
  active: boolean
  expiresAt: string | null
  daysLeft: number | null
  planName: string | null
}

export async function getSubscriptionState(user: {
  id: string
  role: string
  currentPlanId: string | null
}): Promise<SubscriptionState> {
  const free: SubscriptionState = { enforced: false, active: true, expiresAt: null, daysLeft: null, planName: null }

  if (user.role === 'admin' || user.role === 'super_admin') return free
  if (!user.currentPlanId || user.currentPlanId === 'plan_free') return free

  const plan = await db.plan.findUnique({ where: { id: user.currentPlanId } })
  if (!plan || !plan.priceUsd || plan.priceUsd <= 0) return free

  const latest = await db.subscription.findFirst({
    where: { userId: user.id, expiresAt: { not: null } },
    orderBy: { expiresAt: 'desc' },
  })
  // Plan assigned by an admin without a payment/subscription → not enforced.
  if (!latest || !latest.expiresAt) return { ...free, planName: plan.name }

  const msLeft = latest.expiresAt.getTime() - Date.now()
  const active = msLeft > 0
  return {
    enforced: true,
    active,
    expiresAt: latest.expiresAt.toISOString(),
    daysLeft: active ? Math.max(1, Math.ceil(msLeft / DAY_MS)) : 0,
    planName: plan.name,
  }
}

/**
 * Expiry date for a payment being activated right now.
 * Renewing before the plan ends stacks +30 days on top of the remaining time;
 * renewing after it ended starts a fresh 30 days from now.
 */
export async function computeNewExpiry(userId: string): Promise<Date> {
  const latest = await db.subscription.findFirst({
    where: { userId, expiresAt: { not: null } },
    orderBy: { expiresAt: 'desc' },
  })
  const base = latest?.expiresAt && latest.expiresAt.getTime() > Date.now() ? latest.expiresAt.getTime() : Date.now()
  return new Date(base + PLAN_DURATION_MS)
}

/** Standard 403 body for blocked actions. */
export function planExpiredResponseBody(state: SubscriptionState) {
  const when = state.expiresAt ? new Date(state.expiresAt).toUTCString() : ''
  return {
    error: `Your plan expired${when ? ` on ${when}` : ''}. Renew your plan from Plan & Payment to continue — your scheduled pins will resume automatically.`,
    planExpired: true,
  }
}
