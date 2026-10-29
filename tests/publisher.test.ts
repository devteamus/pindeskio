// ─── Publisher tests ──────────────────────────────────────────────────
// Covers:
//   • scheduledFor enforcement (early-firing job re-defers, never publishes early)
//   • concurrent duplicate jobs — exactly one publish per pin (atomic claim)
//   • ambiguous API failures (at-least-once, tagged, longer backoff)
//   • rate-limit backoff, retry, success paths (regression: preserves V7 behavior)
//   • daily-limit rescheduling marks dispatchedAt correctly
//   • cancellation is respected even if a stale job still fires

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  makeDeps, closeDeps, seedBase, cleanSlate, createPin, fakePublisher,
  fakeJob, SEED, type TestDeps, waitFor, liveJobCountForPin,
} from './helpers'
import { processJob, scheduleFollowUp, AMBIGUOUS_RETRY_DELAY_MS } from '../worker/publisher'

const QUEUE = 'pin-publish-publisher-tests'

let deps: TestDeps

beforeAll(async () => {
  deps = await makeDeps(QUEUE)
  await seedBase(deps.db)
})

beforeEach(async () => {
  await cleanSlate(deps)
})

afterAll(async () => {
  await closeDeps(deps)
})

describe('scheduledFor enforcement (Postgres = source of truth)', () => {
  it('a job firing EARLY re-defers the pin instead of publishing it', async () => {
    const fake = fakePublisher()
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 30 * 60_000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    expect(fake.calls.length).toBe(0) // must NOT have published
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('queued')            // untouched, still scheduled
    expect(row?.dispatchedAt).toBeNull()          // forces the dispatcher to re-dispatch at the right time
  })

  it('a job firing within the grace window publishes', async () => {
    const fake = fakePublisher()
    // 30s early is inside the default 60s grace — publish (avoid a dispatch
    // cycle of pure latency for perfectly normal jitter)
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 30_000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    expect(fake.calls.length).toBe(1)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('published')
  })

  it('an overdue pin (scheduledFor in the past) publishes immediately (catch-up)', async () => {
    const fake = fakePublisher()
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 3600_000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    expect(fake.calls.length).toBe(1)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('published')
  })
})

describe('concurrency / duplicate publishing protection', () => {
  it('two jobs for the same pin racing → exactly one publish (atomic claim)', async () => {
    const fake = fakePublisher(async () => {
      // Slow publish so the second job really overlaps the first
      await new Promise((r) => setTimeout(r, 400))
      return { success: true, externalPinId: 'fake_race' }
    })
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    // Two jobs: the deterministic pinId job + a follow-up-style job
    await Promise.all([
      processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id)),
      processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id)),
    ])

    expect(fake.calls.length).toBe(1)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('published')
    expect(row?.externalPinId).toBe('fake_race')
    expect(row?.attemptCount).toBe(1)
  })

  it('a canceled pin is never published, even if a stale job fires', async () => {
    const fake = fakePublisher()
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000), status: 'canceled' })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    expect(fake.calls.length).toBe(0)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('canceled')
  })

  it('per-connection lock defers the second pin while the first publishes', async () => {
    const fake = fakePublisher(async () => {
      await new Promise((r) => setTimeout(r, 500))
      return { success: true, externalPinId: 'fake_locked' }
    })
    const pin1 = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })
    const pin2 = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    // Same connection → second must defer behind the first's lock
    const [, r2] = await Promise.all([
      processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin1.id)),
      processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin2.id)),
    ])

    const row2 = await deps.db.scheduledPin.findUnique({ where: { id: pin2.id } })
    // pin2 was deferred — a follow-up job exists and dispatchedAt is stamped
    expect(row2?.status).toBe('queued')
    expect(await liveJobCountForPin(deps, pin2.id)).toBe(1)
    expect(row2?.dispatchedAt).not.toBeNull()
    expect(fake.calls.length).toBe(1)
  })
})

describe('failure handling (at-least-once)', () => {
  it('AMBIGUOUS failure (timeout): tagged lastError, long backoff, retry_waiting', async () => {
    const fake = fakePublisher(async () => ({
      success: false,
      error: 'Pinterest API request failed (timeout)',
      ambiguous: true,
    }))
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('retry_waiting')
    expect(row?.attemptCount).toBe(1)
    expect(row?.lastError).toContain('AMBIGUOUS')
    expect(row?.lastError).toContain('may already exist')
    // scheduledFor is now the retry time ≈ now + AMBIGUOUS_RETRY_DELAY_MS
    const retryAt = row?.scheduledFor?.getTime() ?? 0
    const expected = Date.now() + AMBIGUOUS_RETRY_DELAY_MS - 5_000
    expect(retryAt).toBeGreaterThan(expected)
    expect(retryAt).toBeLessThan(Date.now() + AMBIGUOUS_RETRY_DELAY_MS + 5_000)
    // a follow-up job exists
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
  })

  it('ordinary failure: short retry delay, retry_waiting, follow-up scheduled', async () => {
    const fake = fakePublisher(async () => ({ success: false, error: 'Pinterest API 400: bad board' }))
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('retry_waiting')
    expect(row?.lastError).not.toContain('AMBIGUOUS')
    // First retry delay is 5s
    const retryAt = row?.scheduledFor?.getTime() ?? 0
    expect(retryAt).toBeGreaterThan(Date.now() + 3_000)
    expect(retryAt).toBeLessThan(Date.now() + 6_000)
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
  })

  it('success after a retry: attemptCount accumulates, counters incremented', async () => {
    let attempt = 0
    const fake = fakePublisher(async () => {
      attempt++
      if (attempt === 1) return { success: false, error: 'Pinterest API 500: boom' }
      return { success: true, externalPinId: 'fake_second_try' }
    })
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id)) // fails
    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id)) // succeeds

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('published')
    expect(row?.attemptCount).toBe(2)
    expect(row?.externalPinId).toBe('fake_second_try')

    const counter = await deps.db.usageCounter.findUnique({
      where: { userId_monthKey: { userId: SEED.userId, monthKey: new Date().toISOString().slice(0, 7) } },
    })
    expect(counter?.publishedCount).toBe(1)
  })

  it('max retries reached → failed_final + failed counter', async () => {
    const fake = fakePublisher(async () => ({ success: false, error: 'Pinterest API 400: nope' }))
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000), attemptCount: 2 })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('failed_final')
    expect(row?.attemptCount).toBe(3)
  })

  it('rate limited (429): stays queued, backoff scheduled, never counts as failure', async () => {
    const fake = fakePublisher(async () => ({
      success: false,
      rateLimited: true,
      retryAfterMs: 7000,
      error: 'Pinterest rate limit (429)',
    }))
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('queued') // NOT retry_waiting, NOT failed
    expect(row?.consecutiveRateLimits).toBe(1)
    expect(row?.attemptCount).toBe(0)
    // honors Retry-After (7s) over the 60s base backoff
    const retryAt = row?.scheduledFor?.getTime() ?? 0
    expect(retryAt).toBeGreaterThan(Date.now() + 5_000)
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
  })

  it('reauth required: pin paused with reconnect message', async () => {
    const fake = fakePublisher(async () => ({ success: false, error: 'REAUTH_REQUIRED', reauthRequired: true }))
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })

    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('paused')
    expect(row?.lastError).toContain('reconnect')
  })

  it('daily limit reached: pin re-queued +24h with follow-up, dispatchedAt consistent', async () => {
    const fake = fakePublisher()
    // Two published pins in the last 24h for this connection (plan daily limit = 10...
    // use the free plan to make the limit small? plans are seeded with dailyPinLimit 10)
    const conn = await deps.db.pinterestConnection.findUnique({ where: { id: SEED.connectionId } })
    const plan = await deps.db.plan.findUnique({ where: { id: SEED.planProId } })
    await createPin(deps.db, {
      status: 'published',
      publishedAt: new Date(Date.now() - 3600_000),
    })
    await createPin(deps.db, {
      status: 'published',
      publishedAt: new Date(Date.now() - 7200_000),
    })
    // Drop the plan's daily limit to 2 for this test
    await deps.db.plan.update({ where: { id: SEED.planProId }, data: { dailyPinLimit: 2 } })

    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() - 1000) })
    await processJob({ ...deps, publishPin: fake.fn }, fakeJob(pin.id))

    expect(fake.calls.length).toBe(0)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.status).toBe('queued')
    const rescheduledTo = row?.scheduledFor?.getTime() ?? 0
    expect(rescheduledTo).toBeGreaterThan(Date.now() + 23 * 3600_000)
    expect(row?.lastError).toContain('Daily limit reached')
    // follow-up job exists for the +24h retry
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
    expect(row?.dispatchedAt).not.toBeNull()

    await deps.db.plan.update({ where: { id: SEED.planProId }, data: { dailyPinLimit: 10 } })
  })
})

describe('scheduleFollowUp horizon rule', () => {
  it('does not create jobs beyond the horizon — leaves the pin to the dispatcher', async () => {
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 1000) })
    const scheduled = await scheduleFollowUp(deps, pin.id, 60 * 60 * 60 * 1000) // 60h > 48h horizon
    expect(scheduled).toBe(false)
    expect(await liveJobCountForPin(deps, pin.id)).toBe(0)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.dispatchedAt).toBeNull() // dispatcher will pick it up inside the window
  })

  it('creates a follow-up job inside the horizon and stamps dispatchedAt', async () => {
    const pin = await createPin(deps.db, { scheduledFor: new Date(Date.now() + 1000) })
    const scheduled = await scheduleFollowUp(deps, pin.id, 5000)
    expect(scheduled).toBe(true)
    expect(await liveJobCountForPin(deps, pin.id)).toBe(1)
    const row = await deps.db.scheduledPin.findUnique({ where: { id: pin.id } })
    expect(row?.dispatchedAt).not.toBeNull()
  })
})
