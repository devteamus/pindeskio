import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { randomUUID } from 'crypto'
import { config } from './config'
import { db } from './db'

// ─── Shared Redis connection ────────────────────────────────────────
// NOTE: only a BullMQ *Worker* needs maxRetriesPerRequest: null (the worker process
// does that). The app only produces jobs, so it uses a bounded value below.
// Cached on globalThis in EVERY environment (not just dev). Next.js can load a
// module more than once (separate route bundles, HMR); with a plain module-level
// `new IORedis()` each copy opened its own Redis connection and none was ever
// closed — the classic slow connection leak that ends in "max number of clients
// reached" and a crashing app.
const globalForRedis = globalThis as unknown as {
  redisConn: IORedis | undefined
}

function createRedisConnection(): IORedis {
  const conn = new IORedis(config.redisUrl, {
    // The app only ENQUEUES (it never runs a blocking BullMQ Worker), so commands
    // must fail fast when Redis is down. With `maxRetriesPerRequest: null` every
    // API request that touched Redis hung forever during an outage; requests and
    // sockets piled up until the process fell over. withConnectionLock() also
    // relies on a rejected command to fall back to its "Redis unavailable" path.
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    keepAlive: 30_000,
    retryStrategy: (times) => Math.min(times * 200, 3_000), // reconnect forever, capped backoff
  })
  // Without an 'error' listener ioredis logs "Unhandled error event" per failure.
  conn.on('error', (err) => console.error('[redis] connection error:', err.message))
  return conn
}

export const redisConnection = globalForRedis.redisConn ?? createRedisConnection()
globalForRedis.redisConn = redisConnection

// ─── Pin publish queue ───────────────────────────────────────────────
// One BullMQ queue for the whole app. Isolation between users/accounts is
// NOT done via separate queues (BullMQ doesn't need that) — it's done via
// a per-connectionId lock taken in the worker at process time (see
// worker/index.ts). This queue just holds "publish this pin at this time"
// jobs; Redis handles the timing (delayed jobs) instead of a 5s DB poll.
export const PIN_QUEUE_NAME = 'pin-publish'

// ─── 48-hour scheduling horizon ──────────────────────────────────────
// PostgreSQL is the source of truth for ALL future schedules; Redis/BullMQ
// is ONLY the execution queue. Pins scheduled further out than the horizon
// are deliberately NOT enqueued — the worker's recurring dispatcher picks
// them up (atomically, via the ScheduledPin_dispatch_pending_idx partial
// index) as they slide into the window. This bounds Redis memory to
// ~horizon worth of pending jobs instead of years of them.
export const SCHEDULING_HORIZON_MS =
  Math.max(1, parseFloat(process.env.SCHEDULING_HORIZON_HOURS || '48')) * 60 * 60 * 1000

const globalForQueue = globalThis as unknown as {
  pinQueue: Queue | undefined
}

export const pinQueue =
  globalForQueue.pinQueue ??
  new Queue(PIN_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  })

globalForQueue.pinQueue = pinQueue
pinQueue.on('error', (err) => console.error('[queue] error:', err.message))

export type EnqueuePinResult =
  | { state: 'enqueued'; jobId: string }
  | { state: 'already-live' }          // a live job already exists for this pin
  | { state: 'beyond-horizon' }        // NOT enqueued — dispatcher will pick it up later
  | { state: 'no-schedule' }           // scheduledFor is null — treated as "due now" by callers

/**
 * Enqueue a scheduled pin to be published at (or after) `scheduledFor`.
 *
 * 48-HOUR HORIZON: pins scheduled further out than SCHEDULING_HORIZON_MS are
 * NOT enqueued here — they stay in PostgreSQL (status 'queued', dispatchedAt
 * NULL) and the worker's recurring dispatcher enqueues them as they come
 * within the window. Callers must NOT treat 'beyond-horizon' as an error.
 *
 * jobId = the pin's own id, so calling this twice for the same pin is a
 * safe no-op (BullMQ dedupes by jobId) instead of creating duplicate jobs.
 */
export async function enqueuePinJob(pinId: string, scheduledFor: Date | null): Promise<EnqueuePinResult> {
  // Far-future pin: leave it to the dispatcher. Make sure dispatchedAt is
  // NULL (needs dispatch) — it is reset by whoever changes scheduledFor, but
  // this is the safety net for legacy rows / partial updates.
  if (scheduledFor && scheduledFor.getTime() - Date.now() > SCHEDULING_HORIZON_MS) {
    await db.scheduledPin.updateMany({
      where: { id: pinId },
      data: { dispatchedAt: null },
    }).catch(() => {}) // DB hiccup -> dispatcher's next cycle still sees old value; pin is not lost
    return { state: 'beyond-horizon' }
  }

  const delay = Math.max(0, (scheduledFor ? scheduledFor.getTime() : Date.now()) - Date.now())

  // BullMQ silently IGNORES add() when a job with the same id still exists — even a
  // finished one cached for 24h. A resumed / retried pin whose earlier job had already
  // completed therefore never got a new job. Drop the stale finished job first.
  const existing = await pinQueue.getJob(pinId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'waiting' || state === 'delayed' || state === 'active' || state === 'prioritized' || state === 'waiting-children') {
      // A live job already exists — a dispatcher may have won the race. Mark the
      // pin as dispatched (a job for this schedule is known to exist).
      await db.scheduledPin.updateMany({ where: { id: pinId }, data: { dispatchedAt: new Date() } }).catch(() => {})
      return { state: 'already-live' }
    }
    await existing.remove().catch(() => {})
  }

  await pinQueue.add(
    'publish',
    { pinId },
    {
      jobId: pinId,
      delay,
      attempts: 1, // retries are handled by our own status machine (retry_waiting), not BullMQ's
    }
  )

  // Job exists for the current schedule — record it so the dispatcher skips
  // this pin until its schedule changes again (dispatchedAt = NULL).
  await db.scheduledPin.updateMany({ where: { id: pinId }, data: { dispatchedAt: new Date() } }).catch(() => {})
  return { state: 'enqueued', jobId: pinId }
}

/**
 * Enqueue many pins at once (bulk CSV import). Respects the 48-hour horizon:
 * only pins due within the window are enqueued; the rest are left for the
 * dispatcher. dispatchedAt is set only for enqueued pins. One Redis pipeline
 * per chunk via addBulk.
 */
export async function enqueuePinJobsWithinHorizon(
  pins: { id: string; scheduledFor: Date | null }[],
  chunkSize = 1000,
): Promise<{ enqueued: number; deferred: number }> {
  const now = Date.now()
  const inWindow = pins.filter(
    (p) => !p.scheduledFor || p.scheduledFor.getTime() - now <= SCHEDULING_HORIZON_MS,
  )
  const beyond = pins.filter(
    (p) => p.scheduledFor && p.scheduledFor.getTime() - now > SCHEDULING_HORIZON_MS,
  )

  // Far-future pins: dispatchedAt NULL (= needs dispatch later)
  for (let i = 0; i < beyond.length; i += chunkSize) {
    await db.scheduledPin.updateMany({
      where: { id: { in: beyond.slice(i, i + chunkSize).map((p) => p.id) } },
      data: { dispatchedAt: null },
    }).catch(() => {})
  }

  // In-window pins: one addBulk pipeline per chunk. If a stale finished job
  // with the same jobId is still cached, BullMQ ignores the add — the worker's
  // due-sweep notices the missing live job and re-enqueues within one cycle,
  // so a failed addBulk chunk can never lose a pin.
  for (let i = 0; i < inWindow.length; i += chunkSize) {
    await pinQueue.addBulk(
      inWindow.slice(i, i + chunkSize).map((p) => ({
        name: 'publish',
        data: { pinId: p.id },
        opts: {
          jobId: p.id,
          delay: Math.max(0, (p.scheduledFor ? p.scheduledFor.getTime() : now) - now),
          attempts: 1,
        },
      })),
    )
  }

  if (inWindow.length > 0) {
    for (let i = 0; i < inWindow.length; i += chunkSize) {
      await db.scheduledPin.updateMany({
        where: { id: { in: inWindow.slice(i, i + chunkSize).map((p) => p.id) } },
        data: { dispatchedAt: new Date() },
      }).catch(() => {})
    }
  }

  return { enqueued: inWindow.length, deferred: beyond.length }
}

/**
 * Remove a pending job for a pin (e.g. when it's canceled before it ran).
 * Safe to call even if no job exists.
 */
export async function removePinJob(pinId: string) {
  const job = await pinQueue.getJob(pinId)
  if (job) {
    const state = await job.getState()
    if (state === 'waiting' || state === 'delayed') {
      await job.remove()
    }
  }
}

// ─── Shared per-connection lock (token refresh race protection) ────
// The worker takes `lock:conn:{connectionId}` around every publish (which
// includes its token refresh). The APP must take the SAME lock before doing
// its own token refresh (e.g. the board-sync route) — otherwise, when the
// app and a worker replica refresh the same connection at the same moment,
// Pinterest's rotating refresh tokens mean one of the two refreshes lands
// with an already-invalidated token, the connection gets flagged
// reauth_required, and the user is forced to reconnect for no reason.
const CONN_LOCK_TTL_MS = 20_000 // same as the worker's CONNECTION_LOCK_MS

export type ConnectionLockResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'busy' }        // lock held the whole maxWaitMs window
  | { ok: false; reason: 'unavailable' } // Redis unreachable (workers can't run either)

export async function withConnectionLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
  opts: { maxWaitMs?: number } = {}
): Promise<ConnectionLockResult<T>> {
  const maxWaitMs = opts.maxWaitMs ?? 6_000
  const key = `lock:conn:${connectionId}`
  const token = randomUUID()
  const startedAt = Date.now()

  try {
    while (Date.now() - startedAt < maxWaitMs) {
      const acquired = await redisConnection.set(key, token, 'PX', CONN_LOCK_TTL_MS, 'NX')
      if (acquired === 'OK') {
        try {
          return { ok: true, value: await fn() }
        } finally {
          // Release only if we still own it (same Lua pattern as the worker).
          const script = `
            if redis.call("GET", KEYS[1]) == ARGV[1] then
              return redis.call("DEL", KEYS[1])
            else
              return 0
            end
          `
          await redisConnection.eval(script, 1, key, token).catch(() => {})
        }
      }
      // A worker replica is publishing for this account right now — usually
      // it will also have just refreshed the token, so waiting briefly and
      // then re-checking inside fn() resolves most contention.
      await new Promise((r) => setTimeout(r, 1_000))
    }
    return { ok: false, reason: 'busy' }
  } catch {
    // Redis unreachable. No worker can be mid-publish in this state (they
    // need Redis too), so a direct refresh without the lock is safe.
    return { ok: false, reason: 'unavailable' }
  }
}
