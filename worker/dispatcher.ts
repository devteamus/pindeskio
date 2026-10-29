// ─── Dispatcher: PostgreSQL is the source of truth, Redis is only the ──
// ─── execution queue. Runs as a recurring cycle inside the worker.    ──
//
// Every cycle (default 30s) does, in order:
//
//   1. ORPHAN RECOVERY — 'publishing' pins stuck >2min (worker crashed
//      mid-publish) go back to 'queued' with dispatchedAt=NULL.
//   2. RESUME PATHS — pins paused by plan-expiry / monthly-quota whose
//      blockers cleared are flipped back to 'queued' with dispatchedAt=NULL.
//      (No direct enqueue — the claim step below owns job creation, which
//      is what keeps the 48h horizon invariant true for resumed pins too.)
//   3. ATOMIC CLAIM — one UPDATE … WHERE id IN (SELECT … FOR UPDATE
//      SKIP LOCKED …) claims up to dispatchBatch pins whose status is
//      queued/retry_waiting, dispatchedAt IS NULL and scheduledFor is
//      within the horizon, then enqueues a deterministic jobId=pinId job
//      for each. SKIP LOCKED + BullMQ's jobId dedupe make multiple
//      dispatcher replicas safe.
//   4. DUE-SWEEP — pins whose scheduledFor has arrived are diffed against
//      the live job ids read straight from BullMQ's Redis keys. Anything
//      missing (lost job, Redis wiped, missed cycle, failed enqueue) is
//      re-enqueued immediately. This is the safety net that guarantees a
//      pin can never be permanently lost: any pin that becomes due gets a
//      job within one cycle of becoming due, no matter what happened to
//      Redis in the meantime.
//
// Bounded work: claim ≤ maxDispatchPerCycle pins/cycle via the
// ScheduledPin_dispatch_pending_idx partial index (only undispatched
// actionable pins are in it — never a scan of the whole table), sweep ≤
// sweepChunk × maxSweepChunks due pins/cycle via (status, scheduledFor),
// and the whole cycle yields after dispatchCycleBudgetMs.

import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { PrismaClient } from '@prisma/client'
import { WorkerConfig, DispatcherMetrics, emptyMetrics } from './context'

export interface DispatcherDeps {
  db: PrismaClient
  queue: Queue
  connection: IORedis
  config: WorkerConfig
  /** Hooks for tests: called when a job is added / skipped */
  onJobAdded?: (pinId: string) => void
  logger?: (msg: string) => void
}

const log = (deps: DispatcherDeps, msg: string) => (deps.logger ?? console.log)(msg)

// ─── Job-id helpers ─────────────────────────────────────────────────
// Primary publish jobs always use jobId = pinId (deterministic — BullMQ
// dedupes re-adds as silent no-ops, which is what makes every retry/race
// in this system idempotent). Follow-up jobs scheduled by the publisher
// (retry / rate-limit / lock-defer) use `${pinId}-${timestamp}` so they
// can coexist with a live pinId job; the sweep's isCoveredByLiveJob()
// recognizes them by the `${pinId}-` prefix.

export function followUpJobId(pinId: string, at: number = Date.now()): string {
  // NOTE: BullMQ jobIds may NEVER contain ":" (Redis key separator).
  return `${pinId}-${at}`
}

/** Live states of a BullMQ job that mean "a job already covers this pin" */
const LIVE_STATES = new Set(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'])

/**
 * Ensure exactly one live publish job exists for `pinId` at `scheduledFor`.
 * Deterministic jobId = pinId: re-adding while a live job exists is a
 * no-op inside BullMQ, and a stale *finished* cached job is removed first
 * so the add is not silently swallowed.
 * Returns true if a job was added, false if a live job already covered it.
 */
export async function ensurePinJob(
  deps: DispatcherDeps,
  pinId: string,
  scheduledFor: Date | null,
): Promise<boolean> {
  const delay = Math.max(0, (scheduledFor ? scheduledFor.getTime() : Date.now()) - Date.now())
  const existing = await deps.queue.getJob(pinId)
  if (existing) {
    const state = await existing.getState()
    if (LIVE_STATES.has(state)) return false // already covered
    // A finished job with the same id is still cached; BullMQ ignores
    // add() for existing jobIds, so drop the stale one first.
    await existing.remove().catch(() => {})
  }
  await deps.queue.add('publish', { pinId }, { jobId: pinId, delay, attempts: 1 })
  deps.onJobAdded?.(pinId)
  return true
}

/**
 * Read the ids of ALL live jobs in the queue straight from BullMQ's Redis
 * keys (lists for wait/active/paused, zsets for delayed/prioritized). Ids
 * only — a few bytes each — so even a queue with tens of thousands of
 * pending jobs is cheap to diff. Reads are capped to bound worst-case
 * memory when something external floods the queue.
 */
export async function getLiveJobIdSet(deps: DispatcherDeps, cap = 50_000): Promise<Set<string>> {
  const prefix = `bull:${deps.config.queueName}`
  const ids: string[] = []
  const [wait, active, paused, delayed, prioritized] = await Promise.all([
    deps.connection.lrange(`${prefix}:wait`, 0, cap - 1).catch(() => [] as string[]),
    deps.connection.lrange(`${prefix}:active`, 0, cap - 1).catch(() => [] as string[]),
    deps.connection.lrange(`${prefix}:paused`, 0, cap - 1).catch(() => [] as string[]),
    deps.connection.zrange(`${prefix}:delayed`, 0, cap - 1).catch(() => [] as string[]),
    deps.connection.zrange(`${prefix}:prioritized`, 0, cap - 1).catch(() => [] as string[]),
  ])
  ids.push(...wait, ...active, ...paused, ...delayed, ...prioritized)
  return new Set(ids)
}

/** Does the live-id set contain a job (primary or follow-up) for pinId? */
function isCoveredByLiveJob(liveIds: Set<string>, pinId: string): boolean {
  if (liveIds.has(pinId)) return true
  // follow-up job `${pinId}-${ts}` — iterate only when the set is small;
  // for big sets fall back to the pinId-only check (ensurePinJob's own
  // dedupe makes an extra add harmless anyway).
  if (liveIds.size <= 20_000) {
    for (const id of liveIds) {
      if (id.length > pinId.length && id.startsWith(pinId) && id[pinId.length] === '-') return true
    }
  }
  return false
}

// ─── Atomic claim (PostgreSQL) ───────────────────────────────────────

interface ClaimedPin {
  id: string
  /** epoch millis (extracted in SQL — immune to any driver TZ interpretation) */
  scheduledForMs: number | null
  status: string
}

/**
 * Atomically claim a batch of pins that need a BullMQ job:
 *   status IN ('queued','retry_waiting')
 *   AND dispatchedAt IS NULL                       ← needs dispatch
 *   AND scheduledFor <= now() + horizon            ← within the window
 *
 * The claim is a single UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 * LOCKED ORDER BY scheduledFor LIMIT batch) — two dispatcher replicas
 * running this concurrently each get a disjoint set of pins, and the
 * partial index ScheduledPin_dispatch_pending_idx means Postgres only
 * ever touches rows that actually need dispatching.
 *
 * scheduledFor is returned as epoch millis computed BY POSTGRES — no
 * timezone interpretation happens in the driver, so delays are always
 * computed against the same clock the DB uses.
 */
export async function claimDispatchBatch(deps: DispatcherDeps): Promise<ClaimedPin[]> {
  const horizonSeconds = deps.config.schedulingHorizonMs / 1000
  const rows = await deps.db.$queryRaw<ClaimedPin[]>`
    UPDATE "ScheduledPin" AS s
    SET "dispatchedAt" = now() AT TIME ZONE 'utc', "updatedAt" = now() AT TIME ZONE 'utc'
    WHERE s."id" IN (
      SELECT "id" FROM "ScheduledPin"
      WHERE "status" IN ('queued', 'retry_waiting')
        AND "dispatchedAt" IS NULL
        AND "scheduledFor" <= (now() AT TIME ZONE 'utc') + make_interval(secs => ${horizonSeconds}::float8)
      ORDER BY "scheduledFor" ASC
      LIMIT ${deps.config.dispatchBatch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING s."id" AS id,
              CASE WHEN s."scheduledFor" IS NULL THEN NULL
                   ELSE (extract(epoch FROM s."scheduledFor") * 1000)::bigint END AS "scheduledForMs",
              s."status" AS status`
  return rows.map((r) => ({
    id: r.id,
    scheduledForMs: r.scheduledForMs != null ? Number(r.scheduledForMs) : null,
    status: r.status,
  }))
}

/** Push pins whose enqueue failed back to dispatchedAt=NULL (retry next cycle) */
async function unclaimPins(deps: DispatcherDeps, pinIds: string[]): Promise<void> {
  if (pinIds.length === 0) return
  await deps.db.scheduledPin.updateMany({
    where: { id: { in: pinIds } },
    data: { dispatchedAt: null },
  }).catch(() => {})
}

// ─── Dispatcher cycle ────────────────────────────────────────────────

let cycling = false

/** Guarded entry point — never two cycles in one process at once. */
export async function dispatchOnceSafe(deps: DispatcherDeps, metrics: DispatcherMetrics): Promise<void> {
  if (cycling) return
  cycling = true
  try {
    await dispatchOnce(deps, metrics)
  } finally {
    cycling = false
  }
}

export async function dispatchOnce(deps: DispatcherDeps, metrics: DispatcherMetrics): Promise<void> {
  const startedAt = Date.now()
  const { db } = deps
  const cfg = deps.config

  let claimed = 0
  let enqueued = 0
  let swept = 0
  let orphans = 0
  let resumed = 0
  let enqueueFailures = 0
  let dbMs = 0

  try {
    // ── 1) Orphaned 'publishing' pins (worker crashed mid-publish) ──
    // Back to queued + dispatchedAt=NULL so step 3 re-dispatches them
    // in this same cycle. (Also the ambiguity window documented in the
    // publisher: a recovered pin MAY double-publish if Pinterest accepted
    // the pin and the worker died before the DB write — at-least-once.)
    const orphanStart = Date.now()
    const stuckSince = new Date(Date.now() - cfg.orphanRecoveryMs)
    const orphaned = await db.scheduledPin.findMany({
      where: { status: 'publishing', updatedAt: { lt: stuckSince } },
      select: { id: true },
      take: cfg.dispatchBatch,
    })
    dbMs = Math.max(dbMs, Date.now() - orphanStart)
    if (orphaned.length > 0) {
      await db.scheduledPin.updateMany({
        where: { id: { in: orphaned.map((p) => p.id) }, status: 'publishing' },
        data: { status: 'queued', dispatchedAt: null },
      })
      orphans = orphaned.length
      log(deps, `[dispatcher] recovered ${orphans} orphaned publishing pins`)
    }

    // ── 2) Resume paths: plan renewed / monthly quota available again ──
    // These only flip status back to queued (+dispatchedAt=NULL); job
    // creation is left to the claim step, which enforces the horizon.
    resumed = await resumeEligiblePausedPins(deps)

    // ── 3) Atomic claim loop ──
    const failedPinIds: string[] = []
    let totalClaimed = 0
    while (totalClaimed < cfg.maxDispatchPerCycle) {
      if (Date.now() - startedAt > cfg.dispatchCycleBudgetMs) break
      const claimStart = Date.now()
      const batch = await claimDispatchBatch(deps)
      dbMs = Math.max(dbMs, Date.now() - claimStart)
      claimed += batch.length
      totalClaimed += batch.length

      for (const pin of batch) {
        try {
          const scheduledFor = pin.scheduledForMs != null ? new Date(pin.scheduledForMs) : null
          const added = await ensurePinJob(deps, pin.id, scheduledFor)
          if (added) enqueued++
        } catch {
          // Redis unavailable / job write rejected — push the pin back so
          // the next cycle retries it. The pin is NOT lost: the due-sweep
          // would also catch it once due.
          failedPinIds.push(pin.id)
          enqueueFailures++
        }
      }

      if (batch.length < cfg.dispatchBatch) break // nothing left to claim
    }
    if (failedPinIds.length > 0) {
      await unclaimPins(deps, failedPinIds)
      log(deps, `[dispatcher] enqueue failed for ${failedPinIds.length} pins — pushed back to undispatched`)
    }

    // ── 4) Due-sweep: every pin whose time has come must have a job ──
    // Covers: Redis data loss, missed dispatch cycles, races, follow-up
    // jobs lost mid-flight, anything. Bounded chunks + time budget.
    const liveIds = await getLiveJobIdSet(deps)
    for (let chunk = 0; chunk < cfg.maxSweepChunks; chunk++) {
      if (Date.now() - startedAt > cfg.dispatchCycleBudgetMs) break
      const sweepStart = Date.now()
      const due = await db.scheduledPin.findMany({
        where: {
          status: { in: ['queued', 'retry_waiting'] },
          scheduledFor: { lte: new Date() },
        },
        select: { id: true, scheduledFor: true, dispatchedAt: true },
        orderBy: { scheduledFor: 'asc' },
        take: cfg.dispatchSweepChunk,
      })
      dbMs = Math.max(dbMs, Date.now() - sweepStart)
      if (due.length === 0) break

      let actedOn = 0
      const markDispatched: string[] = []
      for (const pin of due) {
        if (isCoveredByLiveJob(liveIds, pin.id)) {
          // Covered — but the DB doesn't know it (dispatchedAt NULL, e.g.
          // a bulk import crashed between addBulk and the marker update).
          // Record it so the pin leaves the claim set.
          if (!pin.dispatchedAt) markDispatched.push(pin.id)
          continue
        }
        try {
          const added = await ensurePinJob(deps, pin.id, pin.scheduledFor)
          if (added) {
            enqueued++
            swept++
            actedOn++
            markDispatched.push(pin.id)
          }
        } catch {
          enqueueFailures++ // next cycle (or a later chunk) retries
        }
      }
      if (markDispatched.length > 0) {
        await db.scheduledPin.updateMany({
          where: { id: { in: markDispatched }, status: { in: ['queued', 'retry_waiting'] } },
          data: { dispatchedAt: new Date() },
        }).catch(() => {})
      }
      if (due.length < cfg.dispatchSweepChunk && actedOn === 0) break // fully swept
    }
  } catch (err: any) {
    metrics.lastError = err?.message || String(err)
    log(deps, `[dispatcher] cycle error: ${metrics.lastError}`)
  }

  // ── metrics ──
  const durationMs = Date.now() - startedAt
  metrics.lastRunAt = startedAt
  metrics.lastDurationMs = durationMs
  metrics.lastDbMs = dbMs
  metrics.lastClaimed = claimed
  metrics.lastEnqueued = enqueued
  metrics.lastSwept = swept
  metrics.lastRecoveredOrphans = orphans
  metrics.lastResumed = resumed
  metrics.lastEnqueueFailures = enqueueFailures
  metrics.maxDurationMs = Math.max(metrics.maxDurationMs, durationMs)
  metrics.cycles += 1
  if (durationMs > cfg.dispatchCycleBudgetMs) metrics.slowCycles += 1
  if (metrics.lastError === null || metrics.lastError === undefined) metrics.lastError = null
  if (durationMs > 5000) {
    log(deps, `[dispatcher] slow cycle: ${durationMs}ms (claimed=${claimed} swept=${swept} orphans=${orphans})`)
  }
}

// ─── Resume paths (plan renewed / quota available) ───────────────────
// Mirror of the app's subscription rules. The worker is a separate
// package, so it can't import src/lib/subscription.ts — same logic.

const PLAN_EXPIRED_MARKER = 'Plan expired'
const QUOTA_PAUSED_MARKER = 'Monthly quota exceeded'

async function isPlanExpiredInternal(db: PrismaClient, user: { id: string; role: string; currentPlanId: string | null }): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'super_admin') return false
  if (!user.currentPlanId || user.currentPlanId === 'plan_free') return false
  const plan = await db.plan.findUnique({ where: { id: user.currentPlanId } })
  if (!plan || !plan.priceUsd || plan.priceUsd <= 0) return false
  const latest = await db.subscription.findFirst({
    where: { userId: user.id, expiresAt: { not: null } },
    orderBy: { expiresAt: 'desc' },
  })
  if (!latest || !latest.expiresAt) return false
  return latest.expiresAt.getTime() <= Date.now()
}

/** Shared with publisher.ts (plan-expiry pause/resume marker logic) */
export const isPlanExpired = isPlanExpiredInternal

async function resumeEligiblePausedPins(deps: DispatcherDeps): Promise<number> {
  const { db } = deps
  let resumedTotal = 0

  // a) Pins paused because the monthly plan expired — resume when renewed.
  const planOwners = await db.scheduledPin.findMany({
    where: { status: 'paused', lastError: { startsWith: PLAN_EXPIRED_MARKER } },
    distinct: ['userId'],
    select: { userId: true },
    take: 200,
  })
  for (const { userId } of planOwners) {
    const owner = await db.user.findUnique({ where: { id: userId } })
    if (!owner || owner.status === 'suspended') continue
    if (await isPlanExpiredInternal(db, owner)) continue // still expired — keep paused
    // Flip ALL of this user's plan-paused pins back to queued. The claim
    // step enqueues them within the horizon (far-future pins correctly
    // stay Postgres-only — the old code violated the horizon here).
    let batch: { id: string }[]
    let guard = 0
    do {
      batch = await db.scheduledPin.findMany({
        where: { userId, status: 'paused', lastError: { startsWith: PLAN_EXPIRED_MARKER } },
        select: { id: true },
        take: 500,
      })
      if (batch.length === 0) break
      const res = await db.scheduledPin.updateMany({
        where: { id: { in: batch.map((p) => p.id) }, status: 'paused' },
        data: { status: 'queued', dispatchedAt: null, lastError: null },
      })
      resumedTotal += res.count
      if (++guard > 10) break // ≤5000 pins per user per cycle
    } while (batch.length === 500)
    if (resumedTotal > 0) {
      log(deps, `[dispatcher] plan renewed — resumed pins for user ${userId}`)
    }
  }

  // b) Pins paused for monthly quota — resume as many as quota allows.
  const quotaOwners = await db.scheduledPin.findMany({
    where: { status: 'paused', lastError: { startsWith: QUOTA_PAUSED_MARKER } },
    distinct: ['userId'],
    select: { userId: true },
    take: 200,
  })
  for (const { userId } of quotaOwners) {
    const owner = await db.user.findUnique({ where: { id: userId } })
    if (!owner || owner.status === 'suspended') continue
    if (await isPlanExpiredInternal(db, owner)) continue
    const plan = owner.currentPlanId
      ? await db.plan.findUnique({ where: { id: owner.currentPlanId } })
      : await db.plan.findUnique({ where: { id: 'plan_free' } })
    if (!plan) continue
    const monthKey = new Date().toISOString().slice(0, 7)
    const counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId, monthKey } } })
    const remaining = plan.monthlyPinQuota - (counter?.publishedCount || 0)
    if (remaining <= 0) continue

    const batch = await db.scheduledPin.findMany({
      where: { userId, status: 'paused', lastError: { startsWith: QUOTA_PAUSED_MARKER } },
      select: { id: true },
      orderBy: { scheduledFor: 'asc' },
      take: Math.min(remaining, 1000),
    })
    if (batch.length === 0) continue
    const res = await db.scheduledPin.updateMany({
      where: { id: { in: batch.map((p) => p.id) }, status: 'paused' },
      data: { status: 'queued', dispatchedAt: null, lastError: null },
    })
    resumedTotal += res.count
    if (res.count > 0) {
      log(deps, `[dispatcher] quota available again — resumed ${res.count} pins for user ${userId}`)
    }
  }

  return resumedTotal
}

export { emptyMetrics }
