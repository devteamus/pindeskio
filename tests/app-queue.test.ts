// ─── App-side queue tests (src/lib/queue.ts) ─────────────────────────
// Verifies the 48-hour horizon is enforced at the PRODUCER side too:
//   • in-window pins get deterministic jobId=pinId jobs + dispatchedAt stamp
//   • beyond-horizon pins get NO job and stay dispatchedAt=NULL
//   • bulk helper enqueues only in-window pins
//   • removePinJob (cancel/pause) still works

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import IORedis from 'ioredis'
import {
  TEST_DATABASE_URL, TEST_REDIS_URL, seedBase, createPin, cleanSlateByPrefix, SEED,
} from './helpers'

// src/lib/queue.ts uses env REDIS_URL / DATABASE_URL at module load — the
// vitest config injects the test URLs before modules load.
import {
  enqueuePinJob, enqueuePinJobsWithinHorizon, removePinJob,
  pinQueue, PIN_QUEUE_NAME, SCHEDULING_HORIZON_MS,
} from '../src/lib/queue'

let db: PrismaClient
let connection: IORedis

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } })
  connection = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
  await seedBase(db)
})

beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE TABLE "ScheduledPin", "UsageCounter", "ApiCallLog", "PinAnalyticsDaily", "ImportRow", "ImportBatch" CASCADE`)
  await cleanSlateByPrefix(connection, `bull:${PIN_QUEUE_NAME}:`)
})

afterAll(async () => {
  await pinQueue.close().catch(() => {})
  await connection.quit().catch(() => {})
  await db.$disconnect().catch(() => {})
})

describe('enqueuePinJob — 48h horizon', () => {
  it('in-window pin → job enqueued with jobId=pinId and dispatchedAt stamped', async () => {
    const pin = await createPin(db, { scheduledFor: new Date(Date.now() + 3600_000) })
    const result = await enqueuePinJob(pin.id, pin.scheduledFor)

    expect(result.state).toBe('enqueued')
    const job = await pinQueue.getJob(pin.id)
    expect(job).not.toBeNull()
    expect(job?.id).toBe(pin.id)
    const state = await job?.getState()
    expect(['delayed', 'waiting']).toContain(state)
    const row = await db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.dispatchedAt).not.toBeNull()
  })

  it('beyond-horizon pin → NO job, dispatchedAt stays NULL (dispatcher owns it)', async () => {
    expect(SCHEDULING_HORIZON_MS).toBe(48 * 60 * 60 * 1000)
    const pin = await createPin(db, { scheduledFor: new Date(Date.now() + 100 * 3600_000) })
    const result = await enqueuePinJob(pin.id, pin.scheduledFor)

    expect(result.state).toBe('beyond-horizon')
    const job = await pinQueue.getJob(pin.id)
    expect(job).toBeFalsy() // no job at all
    const row = await db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.dispatchedAt).toBeNull()
    expect(row?.status).toBe('queued')
  })

  it('enqueuePinJob twice for the same pin → still exactly one job', async () => {
    const pin = await createPin(db, { scheduledFor: new Date(Date.now() + 600_000) })
    await enqueuePinJob(pin.id, pin.scheduledFor)
    await enqueuePinJob(pin.id, pin.scheduledFor)

    const prefix = `bull:${PIN_QUEUE_NAME}`
    const delayed = await connection.zrange(`${prefix}:delayed`, 0, -1)
    const wait = await connection.lrange(`${prefix}:wait`, 0, -1)
    const all = [...delayed, ...wait]
    expect(all.filter((id) => id === pin.id).length).toBe(1)
  })

  it('removePinJob removes a delayed job (cancel/pause path preserved)', async () => {
    const pin = await createPin(db, { scheduledFor: new Date(Date.now() + 600_000) })
    await enqueuePinJob(pin.id, pin.scheduledFor)
    await removePinJob(pin.id)
    const job = await pinQueue.getJob(pin.id)
    const state = await job?.getState()
    expect(state).not.toBe('delayed')
    expect(state).not.toBe('waiting')
  })
})

describe('enqueuePinJobsWithinHorizon — bulk import path', () => {
  it('enqueues only in-window pins and reports the split', async () => {
    const inWindow = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPin(db, { scheduledFor: new Date(Date.now() + (i + 1) * 3600_000) })),
    )
    const beyond = await Promise.all(
      Array.from({ length: 7 }, (_, i) => createPin(db, { scheduledFor: new Date(Date.now() + (60 + i) * 3600_000) })),
    )

    const result = await enqueuePinJobsWithinHorizon(
      [...inWindow, ...beyond].map((p) => ({ id: p.id, scheduledFor: p.scheduledFor })),
    )

    expect(result.enqueued).toBe(5)
    expect(result.deferred).toBe(7)

    for (const p of inWindow) {
      const job = await pinQueue.getJob(p.id)
      expect(job).not.toBeNull()
      const row = await db.scheduledPin.findUnique({ where: { id: p.id } })
      expect(row?.dispatchedAt).not.toBeNull()
    }
    for (const p of beyond) {
      const job = await pinQueue.getJob(p.id)
      expect(job).toBeFalsy() // no job at all
      const row = await db.scheduledPin.findUnique({ where: { id: p.id } })
      expect(row?.dispatchedAt).toBeNull()
    }
  })
})
