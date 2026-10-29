// ─── Dispatcher tests ────────────────────────────────────────────────
// Covers the scheduling-horizon requirements:
//   • duplicate dispatch (two cycles, no double jobs)
//   • concurrent dispatchers (SKIP LOCKED + jobId dedupe)
//   • Redis data loss recovery
//   • missed dispatch cycles
//   • orphaned publishing recovery
//   • horizon boundary behavior

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  makeDeps, closeDeps, seedBase, cleanSlate, createPin, freshMetrics,
  liveJobCountForPin, waitFor, SEED, type TestDeps,
} from './helpers'
import { dispatchOnce, claimDispatchBatch, ensurePinJob, getLiveJobIdSet } from '../worker/dispatcher'

const QUEUE = 'pin-publish-dispatcher-tests'

let deps: TestDeps
let deps2: TestDeps // second "replica" (own Prisma + own Redis conn, same DB/Redis)

beforeAll(async () => {
  deps = await makeDeps(QUEUE)
  deps2 = await makeDeps(QUEUE)
  await seedBase(deps.db)
})

beforeEach(async () => {
  await cleanSlate(deps)
})

afterAll(async () => {
  await closeDeps(deps)
  await closeDeps(deps2)
})

describe('atomic claim (FOR UPDATE SKIP LOCKED)', () => {
  it('claims only undispatched, in-window pins and stamps dispatchedAt', async () => {
    const duePin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 60_000) })
    const inWindowPin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 24 * 3600_000) })
    const beyondPin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 100 * 3600_000) })
    const dispatchedPin = await createPin(deps.db, {
      scheduledFor: new Date(Date.now() - 60_000),
      dispatchedAt: new Date(), // already has a job
    })
    const pausedPin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 60_000), status: 'paused' })

    const claimed = await claimDispatchBatch(deps)
    const claimedIds = new Set(claimed.map((p) => p.id))

    expect(claimedIds.has(duePin.id)).toBe(true)
    expect(claimedIds.has(inWindowPin.id)).toBe(true)
    expect(claimedIds.has(beyondPin.id)).toBe(false)   // beyond 48h horizon
    expect(claimedIds.has(dispatchedPin.id)).toBe(false) // already dispatched
    expect(claimedIds.has(pausedPin.id)).toBe(false)     // not actionable

    for (const p of claimed) {
      const row = await deps.db.scheduledPin.findUnique({ where: { id: p.id } })
      expect(row?.dispatchedAt).not.toBeNull()
    }
  })

  it('two concurrent claim batches never claim the same pin', async () => {
    const pins = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        createPin(deps.db, { scheduledFor: new Date(Date.now() + i * 1000) }),
      ),
    )
    const pinIds = new Set(pins.map((p) => p.id))

    // Run both claim batches concurrently (two DB pools = two dispatcher replicas)
    const [a, b] = await Promise.all([claimDispatchBatch(deps), claimDispatchBatch(deps2)])

    const aIds = a.map((p) => p.id)
    const bIds = b.map((p) => p.id)
    const overlap = aIds.filter((id) => bIds.includes(id))

    expect(overlap).toEqual([])
    // Together they should have covered everything in one pass
    expect(new Set([...aIds, ...bIds]).size).toBe(pinIds.size)
  })
})

describe('dispatch cycle', () => {
  it('enqueues deterministic jobId=pinId jobs for claimed pins', async () => {
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 5_000) })
    const metrics = freshMetrics()
    await dispatchOnce(deps, metrics)

    const job = await deps.queue.getJob(pin.id)
    expect(job).not.toBeNull()
    expect(job?.id).toBe(pin.id)
    expect(metrics.lastClaimed).toBe(1)
    expect(metrics.lastEnqueued).toBe(1)
  })

  it('DUPLICATE DISPATCH: running the cycle twice creates no duplicate jobs', async () => {
    const pins = await Promise.all(
      Array.from({ length: 5 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })),
    )

    const m1 = freshMetrics()
    await dispatchOnce(deps, m1)
    expect(m1.lastEnqueued).toBe(5)

    const m2 = freshMetrics()
    await dispatchOnce(deps, m2)
    // Second cycle: nothing left to claim, due pins already covered
    expect(m2.lastClaimed).toBe(0)
    expect(m2.lastEnqueued).toBe(0)

    for (const p of pins) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }
  })

  it('CONCURRENT DISPATCHERS: two cycles in parallel still produce exactly one job per pin', async () => {
    const pins = await Promise.all(
      Array.from({ length: 20 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })),
    )

    await Promise.all([
      dispatchOnce(deps, freshMetrics()),
      dispatchOnce(deps2, freshMetrics()),
    ])

    for (const p of pins) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }
  })

  it('MISSED CYCLES: pins created while the dispatcher was "down" all get jobs in one catch-up cycle', async () => {
    // The dispatcher "has not run" for a while — pins accumulated:
    const overdue = await Promise.all(
      Array.from({ length: 3 }, (_, i) => createPin(deps.db, { scheduledFor: new Date(Date.now() - (i + 1) * 3600_000) })),
    )
    const inWindow = await Promise.all(
      Array.from({ length: 3 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() + 12 * 3600_000) })),
    )
    const beyondHorizon = await Promise.all(
      Array.from({ length: 3 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() + 100 * 3600_000) })),
    )

    const m = freshMetrics()
    await dispatchOnce(deps, m)

    expect(m.lastClaimed).toBe(6) // overdue + in-window
    expect(m.lastRecoveredOrphans).toBe(0)

    for (const p of [...overdue, ...inWindow]) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }
    for (const p of beyondHorizon) {
      // Far-future pins stay Postgres-only — Redis only holds the window.
      expect(await liveJobCountForPin(deps, p.id)).toBe(0)
      const row = await deps.db.scheduledPin.findUnique({ where: { id: p.id } })
      expect(row?.dispatchedAt).toBeNull()
      expect(row?.status).toBe('queued')
    }
  })

  it('REDIS DATA LOSS: due pins are re-enqueued after a full wipe; future pins recover when they become due', async () => {
    const duePins = await Promise.all(
      Array.from({ length: 5 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })),
    )
    const futurePins = await Promise.all(
      Array.from({ length: 5 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() + 2000) })),
    )

    // Normal dispatch: everything in window gets a job
    await dispatchOnce(deps, freshMetrics())
    for (const p of [...duePins, ...futurePins]) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }

    // ── Redis loses EVERYTHING (worse than a restart: AOF wiped too) ──
    await deps.connection.flushdb()

    for (const p of duePins) expect(await liveJobCountForPin(deps, p.id)).toBe(0)

    const m = freshMetrics()
    await dispatchOnce(deps, m)

    // Due pins: immediately re-enqueued by the due-sweep
    for (const p of duePins) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }
    // Future-but-in-window pins: NOT yet due — by design they get a job
    // when their time comes (bounded Redis, at-most-one-cycle lateness).
    // Simulate their time arriving:
    await deps.db.scheduledPin.updateMany({
      where: { id: { in: futurePins.map((p) => p.id) } },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    })
    await dispatchOnce(deps, freshMetrics())
    for (const p of futurePins) {
      expect(await liveJobCountForPin(deps, p.id)).toBe(1)
    }
  })

  it('ORPHAN RECOVERY: publishing pins stuck >2min go back to queued and get a fresh job', async () => {
    const orphan = await createPin(deps.db, {
      status: 'publishing',
      scheduledFor: new Date(Date.now() - 5000),
      // updatedAt older than the 2-minute orphan window (Prisma forces
      // updatedAt on update; set it via raw SQL)
    })
    await deps.db.$executeRawUnsafe(
      `UPDATE "ScheduledPin" SET "updatedAt" = now() - interval '5 minutes' WHERE "id" = $1`,
      orphan.id,
    )

    const m = freshMetrics()
    await dispatchOnce(deps, m)

    expect(m.lastRecoveredOrphans).toBe(1)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: orphan.id } })
    expect(row?.status).toBe('queued')
    expect(await liveJobCountForPin(deps, orphan.id)).toBe(1)
  })

  it('FOLLOW-UP AWARENESS: a pin whose only live job is a follow-up (pinId-<ts>) is not re-enqueued', async () => {
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })
    // The publisher scheduled a follow-up (e.g. lock-defer) — pinId-timestamp id
    await deps.queue.add('publish', { pinId: pin.id }, { jobId: `${pin.id}-${Date.now()}`, delay: 3000, attempts: 1 })
    await deps.db.scheduledPin.update({ where: { id: pin.id }, data: { dispatchedAt: new Date() } })

    const m = freshMetrics()
    await dispatchOnce(deps, m) // due-sweep must see the follow-up and NOT add a pinId job

    expect(m.lastEnqueued).toBe(0)
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
  })
})

describe('ensurePinJob', () => {
  it('skips when a live job exists, replaces a stale finished job', async () => {
    const pinId = 'pin-ensure-1'
    // Stale completed job (cached by removeOnComplete) — run it through a
    // real no-op worker so it lands in the "completed" state properly.
    await deps.queue.add('publish', { pinId }, { jobId: pinId, delay: 0, attempts: 1 })
    const noopWorker = new (await import('bullmq')).Worker(
      QUEUE, async () => {}, { connection: deps.connection },
    )
    await waitFor(async () => (await (await deps.queue.getJob(pinId))?.getState()) === 'completed', { label: 'job completed' })
    await noopWorker.close()

    // Live job absent (completed) → ensurePinJob must remove + re-add
    const added = await ensurePinJob(deps, pinId, new Date(Date.now() + 1000))
    expect(added).toBe(true)
    const state = await (await deps.queue.getJob(pinId))?.getState()
    expect(['delayed', 'waiting']).toContain(state)

    // A live job now exists → second ensure must skip
    const added2 = await ensurePinJob(deps, pinId, new Date(Date.now() + 2000))
    expect(added2).toBe(false)
    expect(await liveJobCountForPin(deps, pinId)).toBe(1)
  })
})

describe('live job id set', () => {
  it('sees jobs in wait/delayed/active and maps follow-ups to their pin', async () => {
    const pinA = 'pin-live-a'
    const pinB = 'pin-live-b'
    await deps.queue.add('publish', { pinId: pinA }, { jobId: pinA, delay: 30_000, attempts: 1 })
    await deps.queue.add('publish', { pinId: pinB }, { jobId: `${pinB}-${Date.now()}`, delay: 30_000, attempts: 1 })

    const live = await getLiveJobIdSet(deps)
    expect(live.has(pinA)).toBe(true)
    // follow-up id present
    let foundFollowUp = false
    for (const id of live) if (id.startsWith(pinB + '-')) foundFollowUp = true
    expect(foundFollowUp).toBe(true)
  })
})
