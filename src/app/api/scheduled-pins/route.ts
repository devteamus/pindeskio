import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { parsePagination } from '@/lib/pagination'
import { enqueuePinJob, removePinJob } from '@/lib/queue'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { connectionId, status } = Object.fromEntries(req.nextUrl.searchParams)
  const { page, limit, skip } = parsePagination(req.nextUrl.searchParams)

  const where: any = { userId: auth.session.userId }
  if (connectionId) where.connectionId = connectionId
  if (status) where.status = status

  const [pins, total] = await Promise.all([
    db.scheduledPin.findMany({
      where,
      include: { board: { select: { boardName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.scheduledPin.count({ where }),
  ])

  return NextResponse.json({ pins, total, page, limit })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { pinId, action } = await req.json()
  const pin = await db.scheduledPin.findFirst({ where: { id: pinId, userId: auth.session.userId } })
  if (!pin) return NextResponse.json({ error: 'Pin not found' }, { status: 404 })

  let update: any = {}
  if (action === 'cancel') update = { status: 'canceled' }
  else if (action === 'pause') update = { status: 'paused' }
  else if (action === 'resume') update = { status: 'queued', dispatchedAt: null }
  else if (action === 'retry' && (pin.status === 'failed_final' || pin.status === 'retry_waiting'))
    update = { status: 'queued', attemptCount: 0, lastError: null, dispatchedAt: null }

  if (Object.keys(update).length > 0) {
    const updated = await db.scheduledPin.update({ where: { id: pinId }, data: update })

    // Keep the BullMQ job in sync with the new status.
    if (update.status === 'canceled' || update.status === 'paused') {
      await removePinJob(pinId)
    } else if (update.status === 'queued') {
      // resume / retry — (re)enqueue at the pin's scheduledFor time, or now
      // if it's already past. enqueuePinJob respects the 48-hour horizon:
      // far-future pins stay Postgres-only and the worker's dispatcher
      // picks them up when they come within the window.
      await enqueuePinJob(pinId, updated.scheduledFor)
    }
  }
  return NextResponse.json({ success: true })
}

// DELETE /api/scheduled-pins
// Body: { scope: 'history' | 'all-final' } or { pinId: '...' }
// - scope: 'history' → delete all published + canceled pins (keep queued/paused/failed)
// - scope: 'all-final' → delete all published + canceled + failed_final pins
// - pinId → delete a single pin by ID (must belong to the user)
// Only deletes pins that belong to the authenticated user. HARD DELETE — permanent.
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))

  // Single-pin delete
  if (body.pinId) {
    const pin = await db.scheduledPin.findFirst({ where: { id: body.pinId, userId: auth.session.userId } })
    if (!pin) return NextResponse.json({ error: 'Pin not found' }, { status: 404 })
    await removePinJob(body.pinId)
    await db.scheduledPin.delete({ where: { id: body.pinId } })
    return NextResponse.json({ success: true, deleted: 1, pinId: body.pinId })
  }

  // Bulk delete by scope
  const scope = body.scope || 'history'
  let statusFilter: string[]
  if (scope === 'history') {
    // Only published + canceled pins (the "history" the user wants to clean up)
    statusFilter = ['published', 'canceled']
  } else if (scope === 'all-final') {
    // Published + canceled + permanently failed (not retry_waiting, not paused, not queued)
    statusFilter = ['published', 'canceled', 'failed_final']
  } else {
    return NextResponse.json({ error: 'Invalid scope. Use "history" or "all-final".' }, { status: 400 })
  }

  const result = await db.scheduledPin.deleteMany({
    where: { userId: auth.session.userId, status: { in: statusFilter } },
  })

  return NextResponse.json({
    success: true,
    scope,
    deleted: result.count,
  })
}
