// ─── End-to-end: real BullMQ Worker + real dispatcher ────────────────
// Covers:
//   • delayed execution — a pin publishes at its scheduledFor (not early,
//     not more than one dispatch cycle late) through a REAL worker
//   • reschedule while a live delayed job exists — old job fires, re-defers,
//     dispatcher re-enqueues, pin publishes at the NEW time
//   • Redis restart (server killed + restarted, data empty) — due pins
//     recover on the next dispatch cycle

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Worker } from 'bullmq'
import {
  makeDeps, closeDeps, seedBase, cleanSlate, createPin, fakePublisher,
  SEED, type TestDeps, waitFor,
} from './helpers'
import { dispatchOnce } from '../worker/dispatcher'
import { processJob } from '../worker/publisher'
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)
const QUEUE = 'pin-publish-e2e-tests'

let deps: TestDeps

beforeAll(async () => {
  deps = await makeDeps(QUEUE, { earlyGraceMs: 1500, dispatchIntervalMs: 2000 })
  await seedBase(deps.db)
})

beforeEach(async () => {
  await cleanSlate(deps)
})

afterAll(async () => {
  await closeDeps(deps)
})

/** Real BullMQ worker running processJob with an injected fake publisher. */
function startWorker(fake: ReturnType<typeof fakePublisher>) {
  const worker = new Worker(
    QUEUE,
    async (job) => {
      await processJob({ ...deps, publishPin: fake.fn }, job)
    },
    { connection: deps.connection, concurrency: 5 },
  )
  return worker
}

/** Runs dispatch cycles every `intervalMs` until `stop()` is called. */
function startDispatcherLoop(intervalMs: number) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      await dispatchOnce(deps, { } as any).catch(() => {})
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  loop()
  return { stop: () => { stopped = true } }
}

describe('delayed execution through a real worker', () => {
  it('publishes at the scheduled time — never early, at most one cycle late', async () => {
    const fake = fakePublisher()
    const worker = startWorker(fake)
    const scheduledFor = new Date(Date.now() + 3000) // +3s
    const pin = await createPin(deps.db, { scheduledFor })

    // Dispatcher cycle enqueues the delayed job…
    await dispatchOnce(deps, {} as any)
    // …and keeps cycling like production would
    const loop = startDispatcherLoop(1000)

    try {
      await waitFor(
        async () => (await deps.db.scheduledPin.findUnique({ where: { id: pin.id } }))?.status === 'published',
        { timeoutMs: 20_000, label: 'pin published' },
      )

      const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
      expect(row?.status).toBe('published')
      expect(row?.externalPinId).toBe('fake_1')
      expect(fake.calls.length).toBe(1)

      // Not early: publishedAt >= scheduledFor (allow 50ms clock skew)
      expect(row!.publishedAt!.getTime()).toBeGreaterThanOrEqual(scheduledFor.getTime() - 50)
      // Not late by more than ~1 dispatch cycle + processing
      expect(row!.publishedAt!.getTime()).toBeLessThanOrEqual(scheduledFor.getTime() + 5_000)
    } finally {
      loop.stop()
      await worker.close()
    }
  })

  it('RESCHEDULE while a live delayed job exists: publishes at the NEW time, not the old one', async () => {
    const fake = fakePublisher()
    const worker = startWorker(fake)
    const originalTime = new Date(Date.now() + 2500)   // old schedule: +2.5s
    const newTime = new Date(Date.now() + 8000)        // rescheduled: +8s
    const pin = await createPin(deps.db, { scheduledFor: originalTime })

    await dispatchOnce(deps, {} as any) // job enqueued for the OLD time
    // User reschedules (+ dispatchedAt=NULL → dispatcher must fix the job)
    await deps.db.scheduledPin.update({
      where: { id: pin.id },
      data: { scheduledFor: newTime, dispatchedAt: null },
    })

    const loop = startDispatcherLoop(1000)
    try {
      // Wait for publication…
      await waitFor(
        async () => (await deps.db.scheduledPin.findUnique({ where: { id: pin.id } }))?.status === 'published',
        { timeoutMs: 25_000, label: 'rescheduled pin published' },
      )
      const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })

      // The old job fired at ~+2.5s but MUST NOT have published (early → re-defer)
      // Published exactly once…
      expect(fake.calls.length).toBe(1)
      // …at the NEW time (allow small skew), definitely not at the old time
      expect(row!.publishedAt!.getTime()).toBeGreaterThanOrEqual(newTime.getTime() - 50)
      expect(row!.publishedAt!.getTime()).toBeLessThanOrEqual(newTime.getTime() + 5_000)
    } finally {
      loop.stop()
      await worker.close()
    }
  })
})

describe('Redis restart (process killed, data lost)', () => {
  it('due pins recover on the next dispatch cycle after Redis comes back empty', async () => {
    const fake = fakePublisher()
    const worker = startWorker(fake)

    const pins = await Promise.all(
      Array.from({ length: 3 }, () => createPin(deps.db, { scheduledFor: new Date(Date.now() + 1500) })),
    )
    await dispatchOnce(deps, {} as any) // jobs enqueued

    // ── Kill redis HARD (simulates crash without persistence) ──
    const { stdout } = await exec('bash', ['-c', 'cat /home/z/my-project/test-infra/redis-test.log 2>/dev/null | grep -i "redis version" | head -1; ps aux | grep "[r]edis-server .*6380" | awk \'{print $2}\''])
    const pid = stdout.trim().split('\n').pop()
    if (!pid) throw new Error('test redis pid not found')
    await exec('kill', ['-9', pid])
    await new Promise((r) => setTimeout(r, 500))

    // ── Restart it (fresh, empty dataset) ──
    await exec('/home/z/my-project/test-infra/redis-server', [
      '--port', '6380', '--daemonize', 'yes', '--save', '', '--appendonly', 'no',
      '--dir', '/home/z/my-project/test-infra', '--logfile', '/home/z/my-project/test-infra/redis-test.log',
    ])
    await new Promise((r) => setTimeout(r, 700))

    // ioredis auto-reconnects; give it a moment, then run a dispatch cycle
    await new Promise((r) => setTimeout(r, 1000))
    await dispatchOnce(deps, {} as any)

    // The pins became due while Redis was gone — they must now publish
    for (const p of pins) {
      await waitFor(
        async () => (await deps.db.scheduledPin.findUnique({ where: { id: p.id } }))?.status === 'published',
        { timeoutMs: 20_000, label: `pin ${p.id} published after redis restart` },
      )
    }
    expect(fake.calls.length).toBe(3)
    await worker.close()
  })
})
