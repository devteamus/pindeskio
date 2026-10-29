import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { parsePagination } from '@/lib/pagination'
import { computeNewExpiry } from '@/lib/subscription'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { status, search } = Object.fromEntries(req.nextUrl.searchParams)
  const { page, limit, skip } = parsePagination(req.nextUrl.searchParams)

  const where: any = { role: 'user' }
  if (status) where.status = status
  if (search) where.email = { contains: search }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      // SECURITY (2nd-pass audit): only count ACTIVE connections here — disconnected accounts are kept
      // in the DB (soft-deleted) for history/limit tracking, so an
      // unfiltered count would misleadingly include accounts the user has
      // since removed.
      //
      // SECURITY (2nd-pass audit): select ONLY the fields the admin panel uses.
      // `include` returned every scalar column — passwordHash and
      // sessionsValidFrom included — exposing bcrypt hashes in an API
      // response and widening the blast radius of any admin-session XSS.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        currentPlanId: true,
        createdAt: true,
        approvedAt: true,
        disabledAt: true,
        currentPlan: { select: { name: true, monthlyPinQuota: true } },
        _count: { select: { connections: { where: { status: { not: 'disconnected' } } }, paymentOrders: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.user.count({ where }),
  ])
  return NextResponse.json({ users, total, page, limit })
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
  const { userId, action, planId } = payload
  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Privilege boundary: the list endpoint only shows role 'user', but PATCH accepted ANY userId —
  // so a regular admin could suspend or re-plan a super_admin (or lock out the other admins).
  // Only a super_admin may act on admin accounts, and nobody may suspend themselves.
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const actorIsSuper = auth.user?.role === 'super_admin'
  if ((target.role === 'admin' || target.role === 'super_admin') && !actorIsSuper) {
    return NextResponse.json({ error: 'Only a super admin can modify admin accounts' }, { status: 403 })
  }
  if (action === 'disable' && target.id === auth.session.userId) {
    return NextResponse.json({ error: 'You cannot suspend your own account' }, { status: 400 })
  }
  if (action === 'change_plan') {
    if (!planId || typeof planId !== 'string' || !(await db.plan.findUnique({ where: { id: planId }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
  }

  let update: any = {}
  if (action === 'approve') update = { status: 'active', approvedAt: new Date() }
  else if (action === 'disable') update = { status: 'suspended', disabledAt: new Date() }
  else if (action === 'enable') update = { status: 'active', disabledAt: null }
  else if (action === 'change_plan' && planId) update = { currentPlanId: planId }

  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const user = await db.user.update({
    where: { id: userId },
    data: update,
    // SECURITY (2nd-pass audit): never return passwordHash/sessionsValidFrom
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      currentPlanId: true,
      createdAt: true,
      approvedAt: true,
      disabledAt: true,
      currentPlan: { select: { id: true, name: true, monthlyPinQuota: true } },
    },
  })

  // Admin moves a payment-managed user onto a paid plan while their last subscription has
  // already expired → without a fresh subscription the plan would still show as "expired"
  // and publishing would stay blocked. Grant a normal 30 days. (Users with NO subscription
  // history, e.g. manually assigned plans, keep the old behaviour: no expiry.)
  if (action === 'change_plan' && planId) {
    const plan = await db.plan.findUnique({ where: { id: planId } })
    if (plan && plan.priceUsd && plan.priceUsd > 0) {
      const latest = await db.subscription.findFirst({ where: { userId, expiresAt: { not: null } }, orderBy: { expiresAt: 'desc' } })
      if (latest?.expiresAt && latest.expiresAt.getTime() <= Date.now()) {
        await db.subscription.create({
          data: { id: `sub_admin_${userId}_${Date.now()}`, userId, planId, status: 'active', expiresAt: await computeNewExpiry(userId) },
        })
      }
    }
  }

  await db.auditLog.create({
    data: { actorType: 'admin', actorId: auth.session!.userId, entityType: 'user', entityId: userId, action: `admin_${action}`, metadataJson: JSON.stringify(update) },
  })

  return NextResponse.json({ user })
}
