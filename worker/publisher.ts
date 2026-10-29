// ─── Publisher: processes one BullMQ publish job ─────────────────────
// Extracted from index.ts so tests can drive processJob directly with an
// injected Pinterest client.
//
// Invariants enforced here:
//   • PostgreSQL is the source of truth — a job that fires EARLIER than
//     the pin's scheduledFor (stale delay, reschedule race) is re-deferred,
//     never published early.
//   • Exactly one publisher wins per pin: the atomic claim
//     (queued/retry_waiting → publishing) means duplicate jobs are no-ops.
//   • Every path that changes scheduledFor resets dispatchedAt=NULL so the
//     dispatcher re-creates the job at the right time; every path that
//     successfully schedules a follow-up job sets dispatchedAt.
//   • Publishing is AT-LEAST-ONCE. Pinterest's v5 API has no idempotency
//     key for POST /pins, so an ambiguous failure (timeout / connection
//     reset AFTER the request was sent / 504 gateway timeout) is retried
//     with a longer delay and an AMBIGUOUS tag on lastError — it may
//     produce a duplicate pin. We do NOT claim exactly-once publishing.

import { Queue, Job } from 'bullmq'
import IORedis from 'ioredis'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { WorkerConfig } from './context'
import { followUpJobId, isPlanExpired } from './dispatcher'

// ─── Configuration (env-overridable, defaults preserved from V7) ────
export const MAX_RETRIES = parseInt(process.env.PIN_MAX_RETRIES || '3', 10)
export const RETRY_DELAYS = [5000, 15000, 45000]
// Ambiguous failures (request may have reached Pinterest) back off much
// longer than ordinary failures: if the first request actually succeeded,
// the retry WILL create a duplicate pin, so there is no value in retrying
// fast — and every retry is another duplicate candidate.
export const AMBIGUOUS_RETRY_DELAY_MS = parseInt(process.env.AMBIGUOUS_RETRY_DELAY_MS || '300000', 10)
export const PINTEREST_API_BASE = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5'
const PINTEREST_TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token'

// How long a per-connection publish lock is held. Must comfortably cover one
// Pinterest API call; if the worker crashes mid-call the lock still expires
// on its own after this, so a stuck connection can't block forever.
// Worst case for ONE publish is ~80s (401 → token refresh 20s → retry fetch 30s,
// plus the first 30s fetch). 90s covers that and a crashed worker still frees
// the account in <2min (before the orphan reconciler).
const CONNECTION_LOCK_MS = 90_000
// If a connection is already locked (another job for the SAME Pinterest
// account is publishing right now), defer this job by a few seconds instead
// of processing it — this is what gives per-account isolation.
const LOCK_WAIT_DEFER_MS = [2000, 3000, 5000]

export interface PublisherDeps {
  db: PrismaClient
  queue: Queue
  connection: IORedis
  config: WorkerConfig
  /** Injectable for tests — defaults to the real Pinterest call. */
  publishPin?: typeof publishPinToPinterest
  logger?: (msg: string) => void
}

const plog = (deps: PublisherDeps, msg: string) => (deps.logger ?? console.log)(msg)

// ─── Pinterest Token Refresh ────────────────────────────────────────
async function refreshPinterestToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
  refresh_token_expires_in?: number
}> {
  const appId = process.env.PINTEREST_APP_ID
  const appSecret = process.env.PINTEREST_APP_SECRET
  if (!appId || !appSecret) throw new Error('Pinterest credentials not configured')

  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64')
  const res = await fetch(PINTEREST_TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    // Hard timeout — without this a hung Pinterest connection pinned a
    // BullMQ concurrency slot + a per-connection lock for up to Node's
    // default 5-minute undici timeout.
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${err}`)
  }
  return res.json()
}

async function getValidAccessToken(db: PrismaClient, conn: any, forceRefresh = false): Promise<{ token: string | null; reauthRequired: boolean }> {
  if (!conn.accessToken || conn.accessToken.startsWith('simulated_')) {
    return { token: null, reauthRequired: false } // Simulated mode
  }

  const now = Date.now()
  const tokenExpiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : 0
  const refreshExpiresAt = conn.refreshTokenExpiresAt ? new Date(conn.refreshTokenExpiresAt).getTime() : 0

  if (!forceRefresh && tokenExpiresAt > now + 5 * 60 * 1000) {
    return { token: conn.accessToken, reauthRequired: false }
  }

  if (!conn.refreshToken || refreshExpiresAt <= now) {
    await db.pinterestConnection.update({ where: { id: conn.id }, data: { status: 'reauth_required' } }).catch(() => {})
    return { token: null, reauthRequired: true }
  }

  try {
    const tokenData = await refreshPinterestToken(conn.refreshToken)
    const newTokenExpiresAt = new Date(now + tokenData.expires_in * 1000)
    const newRefreshExpiresAt = tokenData.refresh_token_expires_in
      ? new Date(now + tokenData.refresh_token_expires_in * 1000)
      : conn.refreshTokenExpiresAt

    await db.pinterestConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || conn.refreshToken,
        tokenExpiresAt: newTokenExpiresAt,
        refreshTokenExpiresAt: newRefreshExpiresAt,
      },
    })

    return { token: tokenData.access_token, reauthRequired: false }
  } catch (err: any) {
    if (err.message?.includes('invalid_grant') || err.message?.includes('refresh_token')) {
      await db.pinterestConnection.update({ where: { id: conn.id }, data: { status: 'reauth_required' } }).catch(() => {})
      return { token: null, reauthRequired: true }
    }
    throw err
  }
}

// ─── Pinterest payload field limits (v5 API hard constraints) ──────
const PIN_FIELD_LIMITS = { title: 100, description: 800, alt_text: 500 } as const

function sanitizePinPayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload
  const p = { ...payload }
  for (const field of Object.keys(PIN_FIELD_LIMITS) as (keyof typeof PIN_FIELD_LIMITS)[]) {
    const v = p[field]
    if (typeof v === 'string' && v.length > PIN_FIELD_LIMITS[field]) {
      p[field] = v.slice(0, PIN_FIELD_LIMITS[field])
    }
  }
  return p
}

// ─── Ambiguous-failure classification ───────────────────────────────
// An error is AMBIGUOUS when the create-pin request may have REACHED
// Pinterest and succeeded even though we saw an error: transport timeouts,
// connections reset after the request was sent, DNS failures are NOT
// ambiguous (request never left), 504 gateway timeouts ARE. These retries
// can duplicate a pin — see the at-least-once note at the top of the file.
function classifyTransportError(err: any): boolean {
  const msg = String(err?.message || err || '')
  const cause = String(err?.cause?.code || err?.cause?.message || '')
  const combined = `${msg} ${cause}`.toLowerCase()
  if (combined.includes('connrefused') || combined.includes('enotfound') || combined.includes('dns')) return false // never delivered
  return (
    combined.includes('timeout') ||
    combined.includes('timed out') ||
    combined.includes('abort') ||
    combined.includes('econnreset') ||
    combined.includes('socket hang up') ||
    combined.includes('epipe') ||
    combined.includes('fetch failed') // undici: request may or may not have been delivered
  )
}

export interface PublishResult {
  success: boolean
  externalPinId?: string
  error?: string
  reauthRequired?: boolean
  rateLimited?: boolean
  retryAfterMs?: number
  /** true when the request MIGHT have created the pin despite the error */
  ambiguous?: boolean
}

export async function publishPinToPinterest(db: PrismaClient, conn: any, pin: any): Promise<PublishResult> {
  const { token, reauthRequired } = await getValidAccessToken(db, conn)

  if (reauthRequired) {
    return { success: false, error: 'REAUTH_REQUIRED', reauthRequired: true }
  }

  if (!token) {
    // Simulated mode must NEVER run in production: it would mark pins "published" with fake
    // IDs without contacting Pinterest. Existing simulated rows fail loudly instead.
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PINS !== 'true') {
      return { success: false, error: 'This connection is a demo/simulated connection and cannot publish in production. Reconnect your Pinterest account.' }
    }
    const success = Math.random() > 0.1
    if (success) {
      return { success: true, externalPinId: `sim_${Math.random().toString(36).substring(2, 12)}` }
    }
    return { success: false, error: 'Pinterest API error: Simulated failure' }
  }

  try {
    // Final safety net: enforce Pinterest's field limits no matter what is
    // stored in the DB.
    const payload = sanitizePinPayload(JSON.parse(pin.payloadJson || '{}'))
    // 30s cap is deliberately well UNDER the reconciler's 2-minute orphan
    // window — a hung publish must fail into the normal retry path, never
    // overlap with the pin being recovered and re-published.
    const response = await fetch(`${PINTEREST_API_BASE}/pins`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
    db.apiCallLog.create({ data: { userId: pin.userId, connectionId: pin.connectionId, endpoint: 'pins' } }).catch(() => {})

    // ── Rate limited (429) — NOT a failure, just back off and retry ──
    if (response.status === 429) {
      const retryAfterSec = parseInt(response.headers.get('retry-after') || '', 10)
      return {
        success: false,
        rateLimited: true,
        retryAfterMs: !isNaN(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
        error: 'Pinterest rate limit (429)',
      }
    }

    // Only 401 means "token rejected". A 403 is a permission / app-access /
    // content problem — reconnecting the account would not fix it.
    if (response.status === 401) {
      // Force a real refresh — the stored token may look unexpired but be revoked.
      const retry = await getValidAccessToken(db, conn, true)
      if (retry.reauthRequired || !retry.token) {
        return { success: false, error: 'REAUTH_REQUIRED', reauthRequired: true }
      }
      const retryResponse = await fetch(`${PINTEREST_API_BASE}/pins`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${retry.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })
      if (retryResponse.status === 429) {
        const retryAfterSec = parseInt(retryResponse.headers.get('retry-after') || '', 10)
        return {
          success: false,
          rateLimited: true,
          retryAfterMs: !isNaN(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
          error: 'Pinterest rate limit (429)',
        }
      }
      if (!retryResponse.ok) {
        const err = await retryResponse.text()
        if (retryResponse.status === 401) {
          return { success: false, error: 'REAUTH_REQUIRED', reauthRequired: true }
        }
        // 504 = gateway timeout: the request may have been processed.
        return {
          success: false,
          error: `Pinterest API ${retryResponse.status}: ${err}`,
          ambiguous: retryResponse.status === 504,
        }
      }
      const retryData = await retryResponse.json()
      return { success: true, externalPinId: retryData.id }
    }

    if (!response.ok) {
      const err = await response.text()
      // 504 = gateway timeout: the request may have been processed and the
      // pin created even though we saw an error — mark it ambiguous so the
      // retry path uses the longer delay and tags lastError.
      return {
        success: false,
        error: `Pinterest API ${response.status}: ${err}`,
        ambiguous: response.status === 504,
      }
    }

    const data = await response.json()
    return { success: true, externalPinId: data.id }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Pinterest API request failed',
      ambiguous: classifyTransportError(err),
    }
  }
}

async function getPublishedCountLast24h(db: PrismaClient, connectionId: string): Promise<number> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return db.scheduledPin.count({
    where: { connectionId, status: 'published', publishedAt: { gte: twentyFourHoursAgo } },
  })
}

// ─── Per-connection lock (THIS is the isolation mechanism) ─────────
async function acquireConnectionLock(deps: PublisherDeps, connectionId: string): Promise<string | null> {
  const token = randomUUID()
  const ok = await deps.connection.set(`lock:conn:${connectionId}`, token, 'PX', CONNECTION_LOCK_MS, 'NX')
  return ok === 'OK' ? token : null
}

async function releaseLock(connection: IORedis, key: string, token: string) {
  // Only release if we still own the lock (avoids releasing a lock some
  // other job already acquired after ours expired).
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `
  await connection.eval(script, 1, key, token).catch(() => {})
}

/**
 * Schedule a short-delay follow-up job for a pin (retry / rate-limit
 * backoff / lock-defer / daily-limit reschedule).
 *
 * • Follow-up jobIds are `${pinId}-${ts}` — they must NOT be plain pinId
 *   because the pin's primary job may be ACTIVE right now (this function
 *   runs inside it) and BullMQ would silently ignore a duplicate id.
 * • Horizon-aware: if the delay exceeds the scheduling horizon, no job is
 *   created — the pin stays dispatchedAt=NULL in Postgres and the
 *   dispatcher picks it up when it slides into the window.
 * • On success the pin's dispatchedAt is stamped (a job is known to
 *   exist); on failure it is left NULL so the dispatcher re-creates it.
 */
export async function scheduleFollowUp(deps: PublisherDeps, pinId: string, delayMs: number): Promise<boolean> {
  if (delayMs > deps.config.schedulingHorizonMs) {
    // Beyond the horizon — leave it to the dispatcher.
    await deps.db.scheduledPin.updateMany({ where: { id: pinId }, data: { dispatchedAt: null } }).catch(() => {})
    return false
  }
  await deps.queue.add('publish', { pinId }, { jobId: followUpJobId(pinId), delay: delayMs, attempts: 1 })
  await deps.db.scheduledPin.updateMany({ where: { id: pinId }, data: { dispatchedAt: new Date() } }).catch(() => {})
  return true
}

// ─── Job Processing ─────────────────────────────────────────────────
export async function processJob(deps: PublisherDeps, job: Job): Promise<void> {
  const { db } = deps
  const { pinId } = job.data as { pinId: string }
  const publish = deps.publishPin ?? ((d, c, p) => publishPinToPinterest(d, c, p))

  const pin = await db.scheduledPin.findUnique({
    where: { id: pinId },
    include: { user: true, connection: true },
  })
  if (!pin) return
  // 'retry_waiting' pins are scheduled for a follow-up job after a failure.
  if (pin.status !== 'queued' && pin.status !== 'retry_waiting') return // already handled, canceled, or paused since this job was scheduled

  // ── PostgreSQL is the source of truth for WHEN ──
  // A job that fires before the pin's scheduledFor (stale delay from a
  // reschedule, dispatcher race, follow-up with an old time) must NOT
  // publish early — re-defer it and let the dispatcher enqueue a job with
  // the correct delay. updateMany + status guard: if another job already
  // claimed/published/paused the pin meanwhile, this is a no-op.
  if (pin.scheduledFor && pin.scheduledFor.getTime() - Date.now() > deps.config.earlyGraceMs) {
    const remaining = pin.scheduledFor.getTime() - Date.now()
    plog(deps, `[publisher] pin ${pinId} job fired ${Math.round(remaining / 1000)}s early — re-deferring`)
    await db.scheduledPin.updateMany({
      where: { id: pinId, status: { in: ['queued', 'retry_waiting'] } },
      data: { dispatchedAt: null }, // keep status; force redispatch
    }).catch(() => {})
    return
  }

  // ── Acquire the per-account lock BEFORE touching status ──
  const lockToken = await acquireConnectionLock(deps, pin.connectionId)
  if (!lockToken) {
    // Another job for this SAME Pinterest account is publishing right now.
    // Defer this one a few seconds — it does NOT wait behind other users'
    // accounts, only behind its own account's in-flight publish.
    const jitter = LOCK_WAIT_DEFER_MS[Math.floor(Math.random() * LOCK_WAIT_DEFER_MS.length)]
    await scheduleFollowUp(deps, pinId, jitter)
    return
  }

  try {
    // Claim the pin atomically — guards against a duplicate job racing us,
    // AND refuses to claim a pin whose scheduledFor was pushed into the
    // future after our pre-claim read (reschedule race): the early-fire
    // rule is part of the claim's WHERE clause, so no stale read can ever
    // publish early. duplicate jobs are no-ops.
    const claimCutoff = new Date(Date.now() + deps.config.earlyGraceMs)
    const claimed = await db.scheduledPin.updateMany({
      where: {
        id: pinId,
        status: { in: ['queued', 'retry_waiting'] },
        OR: [{ scheduledFor: { lte: claimCutoff } }, { scheduledFor: null }],
      },
      data: { status: 'publishing' },
    })
    if (claimed.count === 0) {
      // Either another job won the race, the pin was canceled/paused since
      // our read, or it got rescheduled into the future. Only the reschedule
      // case needs action: push it back to undispatched so the dispatcher
      // recreates a job at the NEW time (a fresh read decides).
      const fresh = await db.scheduledPin.findUnique({
        where: { id: pinId },
        select: { status: true, scheduledFor: true },
      })
      if (
        fresh &&
        (fresh.status === 'queued' || fresh.status === 'retry_waiting') &&
        fresh.scheduledFor &&
        fresh.scheduledFor.getTime() - Date.now() > deps.config.earlyGraceMs
      ) {
        plog(deps, `[publisher] pin ${pinId} claim refused — scheduled ${Math.round((fresh.scheduledFor.getTime() - Date.now()) / 1000)}s out; re-deferring`)
        await db.scheduledPin.updateMany({
          where: { id: pinId, status: { in: ['queued', 'retry_waiting'] } },
          data: { dispatchedAt: null }, // keep status; force redispatch at the new time
        }).catch(() => {})
      }
      return
    }

    if (pin.user.status === 'suspended') {
      await db.scheduledPin.update({ where: { id: pin.id }, data: { status: 'paused', lastError: 'User account suspended' } })
      return
    }

    // Monthly plan expired → stop publishing. The pin is only PAUSED (never
    // deleted/failed) and the dispatcher resumes it automatically once the
    // user renews — it continues exactly where it stopped.
    if (await isPlanExpired(db, pin.user)) {
      await db.scheduledPin.update({ where: { id: pin.id }, data: { status: 'paused', lastError: 'Plan expired — renew your plan to resume publishing (this pin resumes automatically after renewal).' } })
      return
    }

    // Account was disconnected (tokens wiped). Without this guard the worker treated the
    // missing token as a *simulated* connection and marked the pin "published" for real.
    if (pin.connection.status === 'disconnected') {
      await db.scheduledPin.update({ where: { id: pin.id }, data: { status: 'canceled', lastError: 'Pinterest account was disconnected' } })
      return
    }

    if (pin.connection.status === 'reauth_required') {
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'paused', lastError: 'Pinterest connection needs re-authorization. Please reconnect your account.' },
      })
      return
    }

    const isSimulated = !pin.connection.accessToken || pin.connection.accessToken.startsWith('simulated_')
    if (!isSimulated && pin.connection.status !== 'active') {
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'paused', lastError: `Pinterest connection not active (status: ${pin.connection.status})` },
      })
      return
    }

    const plan = pin.user.currentPlanId
      ? await db.plan.findUnique({ where: { id: pin.user.currentPlanId } })
      : await db.plan.findUnique({ where: { id: 'plan_free' } })

    // Per-account daily limit
    const dailyPinLimit = plan?.dailyPinLimit || 10
    const publishedLast24h = await getPublishedCountLast24h(db, pin.connectionId)
    if (publishedLast24h >= dailyPinLimit) {
      const nextSlot = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'queued', scheduledFor: nextSlot, dispatchedAt: null, lastError: `Daily limit reached (${dailyPinLimit}/24h). Rescheduled.` },
      })
      await scheduleFollowUp(deps, pin.id, 24 * 60 * 60 * 1000)
      return
    }

    // Monthly quota
    const monthKey = new Date().toISOString().slice(0, 7)
    let counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId: pin.userId, monthKey } } })
    if (!counter) {
      // Two jobs for the SAME user on DIFFERENT Pinterest connections can
      // run concurrently (the per-connection lock doesn't serialize them) and
      // both land here with no counter yet. The unique (userId, monthKey)
      // constraint makes the second create throw P2002 — catch it and use the
      // row the winner created instead of crashing the job (a crash here
      // would strand the pin in 'publishing' for the 2-minute orphan window).
      try {
        counter = await db.usageCounter.create({ data: { userId: pin.userId, monthKey } })
      } catch {
        counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId: pin.userId, monthKey } } })
      }
    }
    if (counter && plan && counter.publishedCount >= plan.monthlyPinQuota) {
      await db.scheduledPin.update({ where: { id: pin.id }, data: { status: 'paused', lastError: 'Monthly quota exceeded — resumes automatically next month or after a plan upgrade' } })
      return
    }

    // ── Actual publish (only ONE of these runs per Pinterest account at a time) ──
    const result = await publish(db, pin.connection, pin)

    // ── Rate limited (429): back off and retry — NEVER counts as a failure ──
    // Exponential: 60s → 2m → 4m → 8m → 15m (cap), + jitter. Resets as soon
    // as any real outcome (success or real error) happens.
    if (result.rateLimited) {
      const consecutive = pin.consecutiveRateLimits || 0
      const baseMs = Math.min(60_000 * Math.pow(2, Math.min(consecutive, 4)), 15 * 60_000)
      const jitterMs = Math.floor(Math.random() * 15_000)
      const delayMs = Math.max(result.retryAfterMs || 0, baseMs) + jitterMs
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: {
          status: 'queued',
          consecutiveRateLimits: consecutive + 1,
          scheduledFor: new Date(Date.now() + delayMs),
          dispatchedAt: null,
          lastError: `Rate limited by Pinterest (429) — retrying in ${Math.round(delayMs / 1000)}s`,
        },
      })
      await scheduleFollowUp(deps, pin.id, delayMs)
      plog(deps, `[publisher] pin ${pin.id} rate limited (429), deferring ${Math.round(delayMs / 1000)}s (streak ${consecutive + 1})`)
      return
    }

    if (result.success) {
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'published', externalPinId: result.externalPinId, publishedAt: new Date(), attemptCount: pin.attemptCount + 1, consecutiveRateLimits: 0, lastError: null },
      })
      // upsert: if the counter row somehow vanished between the quota check
      // and here, increment-on-create instead of throwing (a throw would mark
      // a SUCCEEDED publish as a crashed job and strand the pin in 'publishing').
      await db.usageCounter.upsert({
        where: { userId_monthKey: { userId: pin.userId, monthKey } },
        create: { userId: pin.userId, monthKey, publishedCount: 1 },
        update: { publishedCount: { increment: 1 } },
      }).catch(() => {})
      plog(deps, `[publisher] published pin ${pin.id} (conn ${pin.connectionId}) → ${result.externalPinId}`)
      return
    }

    if (result.reauthRequired) {
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'paused', lastError: 'Pinterest connection expired. Please reconnect your account.' },
      })
      plog(deps, `[publisher] pin ${pin.id} paused — reauth required`)
      return
    }

    // ── Failure → retry or fail_final ──
    // AMBIGUOUS failures (timeout / reset after send / 504): the pin MAY
    // already exist on Pinterest. Retry with the longer delay and keep the
    // tag in lastError so the duplicate is explainable after the fact.
    const errorLabel = result.ambiguous
      ? `AMBIGUOUS (pin may already exist on Pinterest — duplicate possible): ${result.error}`
      : (result.error || 'Publish failed')
    const newAttempt = pin.attemptCount + 1
    if (newAttempt >= MAX_RETRIES) {
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'failed_final', attemptCount: newAttempt, consecutiveRateLimits: 0, lastError: errorLabel },
      })
      await db.usageCounter.upsert({
        where: { userId_monthKey: { userId: pin.userId, monthKey } },
        create: { userId: pin.userId, monthKey, failedCount: 1 },
        update: { failedCount: { increment: 1 } },
      }).catch(() => {})
      plog(deps, `[publisher] pin ${pin.id} FAILED permanently: ${errorLabel}`)
    } else {
      const delay = result.ambiguous
        ? AMBIGUOUS_RETRY_DELAY_MS
        : RETRY_DELAYS[Math.min(pin.attemptCount, RETRY_DELAYS.length - 1)] || 45000
      await db.scheduledPin.update({
        where: { id: pin.id },
        data: { status: 'retry_waiting', attemptCount: newAttempt, consecutiveRateLimits: 0, scheduledFor: new Date(Date.now() + delay), dispatchedAt: null, lastError: `Failed (attempt ${newAttempt}/${MAX_RETRIES}): ${errorLabel}` },
      })
      await scheduleFollowUp(deps, pin.id, delay)
      plog(deps, `[publisher] pin ${pin.id} retry ${newAttempt}/${MAX_RETRIES} in ${delay}ms: ${errorLabel}`)
    }
  } finally {
    await releaseLock(deps.connection, `lock:conn:${pin.connectionId}`, lockToken)
  }
}
