import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/import-batches
// Returns the user's recent import batches with row + scheduled-pin status.
// Optional query params:
//   - batchId: if provided, returns full row breakdown for that single batch
//   - limit:   number of batches to return (default 10, max 50)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { batchId, limit: limitStr } = Object.fromEntries(req.nextUrl.searchParams)
  const limit = Math.min(Math.max(parseInt(limitStr || '10') || 10, 1), 50)

  // ─── Single-batch detail mode ─────────────────────────────
  if (batchId) {
    const batch = await db.importBatch.findFirst({
      where: { id: batchId, userId: auth.session.userId },
      include: {
        connection: { select: { nickname: true, profileName: true } },
        rows: {
          orderBy: { rowNumber: 'asc' },
          include: {
            scheduledPin: {
              select: {
                id: true,
                scheduledFor: true,
                status: true,
                publishedAt: true,
                lastError: true,
                externalPinId: true,
                attemptCount: true,
              },
            },
            resolvedBoard: { select: { boardName: true } },
          },
        },
      },
    })
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

    // Aggregate status counts for quick dashboard display
    const statusCounts: Record<string, number> = {}
    for (const row of batch.rows) {
      const s = row.scheduledPin?.status || (row.validationStatus === 'invalid' ? 'invalid' : 'pending')
      statusCounts[s] = (statusCounts[s] || 0) + 1
    }

    return NextResponse.json({ batch, statusCounts })
  }

  // ─── List mode: recent batches with summary ───────────────
  const batches = await db.importBatch.findMany({
    where: { userId: auth.session.userId },
    include: {
      connection: { select: { nickname: true, profileName: true } },
      _count: { select: { rows: true, scheduledPins: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // For each batch, get a quick status breakdown of its scheduled pins.
  // groupBy (status, batchId index) — the old version loaded EVERY pin row
  // of every listed batch just to count statuses, which made a 50k-pin
  // import drag the whole history page down with it.
  const enriched = await Promise.all(
    batches.map(async (b) => {
      const grouped = await db.scheduledPin.groupBy({
        by: ['status'],
        where: { batchId: b.id },
        _count: { _all: true },
      })
      const byStatus: Record<string, number> = {}
      for (const g of grouped) byStatus[g.status] = g._count._all
      return { ...b, statusBreakdown: byStatus }
    })
  )

  return NextResponse.json({ batches: enriched })
}

// PATCH /api/import-batches
// Body: { batchId, action }
// action: 'pause' | 'resume' | 'cancel'
// Affects ALL non-final pins in the batch (queued, publishing, retry_waiting, paused).
// Already-published or canceled pins are never touched.
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { batchId, action } = await req.json().catch(() => ({}))
  if (!batchId || !action) {
    return NextResponse.json({ error: 'batchId and action are required' }, { status: 400 })
  }
  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Must be pause, resume, or cancel' }, { status: 400 })
  }

  // Verify ownership
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId: auth.session.userId } })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Determine which statuses to target for this action
  // ── pause: stop any pin that hasn't been published/canceled yet
  // ── resume: re-queue pins the user previously paused
  // ── cancel: permanently cancel everything that hasn't been published yet
  let targetWhere: any
  let newStatus: string

  if (action === 'pause') {
    targetWhere = { status: { in: ['queued', 'publishing', 'retry_waiting'] } }
    newStatus = 'paused'
  } else if (action === 'resume') {
    targetWhere = { status: 'paused' }
    newStatus = 'queued'
  } else {
    // cancel
    targetWhere = { status: { in: ['queued', 'publishing', 'retry_waiting', 'paused'] } }
    newStatus = 'canceled'
  }

  const result = await db.scheduledPin.updateMany({
    where: { batchId, userId: auth.session.userId, ...targetWhere },
    data: {
      status: newStatus,
      // resume: dispatchedAt=NULL re-enters the pins into the dispatcher's
      // claim set (the partial index on (scheduledFor) WHERE dispatchedAt IS
      // NULL) — the worker enqueues them as they come within the 48h horizon.
      // pause/cancel: any live jobs no-op at process time via the status
      // check, exactly as before.
      dispatchedAt: action === 'resume' ? null : undefined,
      lastError: action === 'pause'
        ? 'Paused by user'
        : action === 'cancel'
          ? 'Canceled by user'
          : null,
    },
  })

  // Update batch status for UI feedback
  const remainingActive = await db.scheduledPin.count({
    where: { batchId, status: { in: ['queued', 'publishing', 'retry_waiting', 'paused'] } },
  })
  const newBatchStatus = action === 'cancel' && remainingActive === 0
    ? 'completed'
    : action === 'pause'
      ? 'paused'
      : 'processing'
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: newBatchStatus },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    action,
    affected: result.count,
    batchStatus: newBatchStatus,
  })
}

// DELETE /api/import-batches
// Body: { batchId }
// Permanently deletes a batch AND all its import rows AND scheduled pins.
// This is a HARD DELETE — data is gone from the database forever.
// Only the batch owner can delete it. Already-published pins are also deleted
// (user explicitly asked for permanent deletion to clean up history).
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { batchId } = await req.json().catch(() => ({}))
  if (!batchId) {
    return NextResponse.json({ error: 'batchId is required' }, { status: 400 })
  }

  // Verify ownership
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId: auth.session.userId } })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  // Delete in correct order to respect foreign key constraints:
  // 1. Scheduled pins belonging to this batch
  // 2. Import rows belonging to this batch
  // 3. The batch itself
  // (Cascade delete is configured on ImportRow.batchId, but ScheduledPin.batchId
  // is nullable and NOT cascaded — so we delete them explicitly first.)
  const pinsDeleted = await db.scheduledPin.deleteMany({
    where: { batchId, userId: auth.session.userId },
  })
  const rowsDeleted = await db.importRow.deleteMany({
    where: { batchId },
  })
  await db.importBatch.delete({ where: { id: batchId } })

  return NextResponse.json({
    success: true,
    deleted: true,
    pinsDeleted: pinsDeleted.count,
    rowsDeleted: rowsDeleted.count,
    batchId,
  })
}
