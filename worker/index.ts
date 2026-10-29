import { PrismaClient } from '@prisma/client'
import { Worker, Queue, Job } from 'bullmq'
import IORedis from 'ioredis'
import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { loadWorkerConfigFromEnv, emptyMetrics, type DispatcherMetrics } from './context'
import {
  dispatchOnceSafe,
  type DispatcherDeps,
} from './dispatcher'
import {
  processJob,
  scheduleFollowUp,
  MAX_RETRIES,
  type PublisherDeps,
} from './publisher'

// Prisma's default pool is (CPU cores × 2 + 1) connections — far fewer than
// WORKER_CONCURRENCY parallel jobs need, which shows up as
// "Timed out fetching a new connection from the connection pool" under load.
// Size it explicitly (env WORKER_DB_POOL, default 20 per worker replica) unless
// DATABASE_URL already sets connection_limit. Keep replicas × pool below
// Postgres max_connections (default 100).
function withPoolParams(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url)
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', process.env.WORKER_DB_POOL || '20')
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '30')
    return u.toString()
  } catch {
    return url
  }
}

const db = new PrismaClient({
  datasourceUrl: withPoolParams(process.env.DATABASE_URL),
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
})

// ─── Configuration ─────────────────────────────────────────────────
const WORKER_PORT = parseInt(process.env.WORKER_PORT || '3001', 10)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '25', 10)
const config = loadWorkerConfigFromEnv()
const PIN_QUEUE_NAME = config.queueName

// ─── Data Retention (storage protection — 35GB disk target) ────────
// Final-status pins are purged after PIN_RETENTION_DAYS (published/canceled/
// failed_final — queued/paused/retry pins are NEVER deleted). Import batches
// (+ their rows, via cascade) and API call logs are purged sooner because
// they're only needed short-term for the upload history UI. CSV files are
// never written to disk in the first place (uploads are parsed in memory),
// so the DB is the only thing that grows.
const PIN_RETENTION_DAYS = parseInt(process.env.PIN_RETENTION_DAYS || '14', 10)
const IMPORT_RETENTION_DAYS = parseInt(process.env.IMPORT_RETENTION_DAYS || '7', 10)
const API_LOG_RETENTION_DAYS = parseInt(process.env.API_LOG_RETENTION_DAYS || '7', 10)
const AUDIT_LOG_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '60', 10)
// Re-check every 30 min; a purge actually runs at most once per ~20h.
const PURGE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const PURGE_MIN_GAP_MS = 20 * 60 * 60 * 1000
const PURGE_LOCK_KEY = 'lock:purge'
const PURGE_LOCK_TTL_MS = 30 * 60 * 1000 // covers a slow chunked purge
const PURGE_LAST_RUN_KEY = 'purge:last-completed'
const PURGE_CHUNK = 5000 // rows per deleteMany — avoids long locks / WAL spikes

// ─── Disk safety ─────────────────────────────────────────────────
const DISK_WARN_PERCENT = parseInt(process.env.DISK_WARN_PERCENT || '80', 10)
const DISK_CHECK_INTERVAL_MS = 10 * 60 * 1000
let lastDiskWarnAt = 0

// ONE shared ioredis connection for this whole process (BullMQ's Queue reuses it;
// the Worker adds exactly one extra blocking connection of its own).
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, keepAlive: 30_000 })
// Without a listener ioredis logs "Unhandled error event" on every reconnect
// attempt; with one we log once per error and ioredis keeps reconnecting by itself.
connection.on('error', (err) => console.error('[worker] Redis connection error:', err.message))

// Finished jobs must NOT pile up in Redis forever: jobs created by the worker
// (retries, rate-limit follow-ups, dispatcher, resume) must always carry
// removeOnComplete/removeOnFail limits, so Redis memory stays bounded by the
// 48-hour scheduling horizon plus these caps.
const pinQueue = new Queue(PIN_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  },
})
pinQueue.on('error', (err) => console.error('[worker] Queue error:', err.message))

// ─── Dispatcher (PostgreSQL = source of truth, Redis = execution queue) ──
const dispatcherMetrics: DispatcherMetrics = emptyMetrics()
const dispatcherDeps: DispatcherDeps = { db, queue: pinQueue, connection, config }
const publisherDeps: PublisherDeps = { db, queue: pinQueue, connection, config }

// ─── Redis connection + memory monitoring ──────────────────────────
// Reads INFO on the EXISTING shared connection — never creates a new one.
// Exposes connected clients AND memory (used vs maxmemory) so /health can
// alert before maxmemory/noeviction starts rejecting job writes.
// Cached for 30s so even a 1s-interval prober can't add load.
let redisStatsCache: {
  at: number
  data: {
    status: string
    connectedClients: number | null
    blockedClients: number | null
    usedMemoryBytes: number | null
    maxMemoryBytes: number | null
    maxMemoryPolicy: string | null
    memoryPercent: number | null
  }
} = {
  at: 0,
  data: { status: 'unknown', connectedClients: null, blockedClients: null, usedMemoryBytes: null, maxMemoryBytes: null, maxMemoryPolicy: null, memoryPercent: null },
}

async function getRedisStats() {
  if (Date.now() - redisStatsCache.at < 30_000) return redisStatsCache.data
  const status = connection.status
  let connectedClients: number | null = null
  let blockedClients: number | null = null
  let usedMemoryBytes: number | null = null
  let maxMemoryBytes: number | null = null
  let maxMemoryPolicy: string | null = null
  let memoryPercent: number | null = null
  if (status === 'ready') {
    try {
      const info = await connection.info('clients') + await connection.info('memory')
      const get = (k: string) => {
        const m = info.match(new RegExp(`^${k}:(\\d+)`, 'm'))
        return m ? parseInt(m[1], 10) : null
      }
      connectedClients = get('connected_clients')
      blockedClients = get('blocked_clients')
      usedMemoryBytes = get('used_memory')
      maxMemoryBytes = get('maxmemory')
      memoryPercent = get('maxmemory') && get('used_memory') && maxMemoryBytes! > 0
        ? Math.round((usedMemoryBytes! / maxMemoryBytes!) * 100)
        : null
      const pol = info.match(/^maxmemory_policy:(\S+)/m)
      maxMemoryPolicy = pol ? pol[1] : null
    } catch {
      /* keep nulls — Redis hiccup, not fatal */
    }
  }
  redisStatsCache = {
    at: Date.now(),
    data: { status, connectedClients, blockedClients, usedMemoryBytes, maxMemoryBytes, maxMemoryPolicy, memoryPercent },
  }
  return redisStatsCache.data
}

/** DB ping latency (ms) — detects a saturated Prisma pool / slow Postgres. */
async function dbPingMs(): Promise<number | null> {
  try {
    const t = Date.now()
    await db.$queryRaw`SELECT 1`
    return Date.now() - t
  } catch {
    return null
  }
}

// ─── Daily Storage Purge (keeps a small disk from filling up) ───────
// Runs at most once per ~20h across ALL worker replicas (Redis lock +
// last-completed timestamp decide who runs it). Deletes in chunks so we
// never hold long table locks or blow up the WAL with one giant delete.
//
// What is purged:
//   1. FINAL pins older than PIN_RETENTION_DAYS (default 14d)
//      → published / canceled / failed_final ONLY. Queued, paused,
//        retry_waiting and publishing pins are NEVER touched.
//      → PinAnalyticsDaily rows cascade-delete with their pins.
//   2. ImportBatches older than IMPORT_RETENTION_DAYS (default 7d)
//      → ImportRows cascade-delete with the batch. Any still-scheduled
//        pins keep running (their batchId/importRowId are SetNull'd).
//   3. ApiCallLog older than API_LOG_RETENTION_DAYS (default 7d)
//   4. AuditLog older than AUDIT_LOG_RETENTION_DAYS (default 60d)
//   5. Expired PasswordResetOtp rows (>24h past expiry)
//   6. Legacy PinAnalyticsDaily cache rows past PIN_RETENTION_DAYS
//
// CSV upload files are never stored on disk at all (parsed in memory),
// so the database is the only thing this job needs to keep bounded.
async function purgeOldData(): Promise<void> {
  const now = Date.now()
  let totalPurged = 0

  // 0) Redis hygiene: drop finished BullMQ jobs that older worker versions left behind
  //    with no expiry (new jobs expire on their own via defaultJobOptions).
  for (const [type, graceMs] of [['completed', 24 * 3600_000], ['failed', 7 * 24 * 3600_000]] as const) {
    for (let guard = 0; guard < 200; guard++) {
      const ids = await pinQueue.clean(graceMs, 5000, type).catch(() => [] as string[])
      if (ids.length > 0) totalPurged += ids.length
      if (ids.length < 5000) break
    }
  }

  // Chunked delete helper: find ids (bounded take) → deleteMany(id IN …)
  // → repeat until nothing left. Prisma's deleteMany has no `take`, so the
  // two-step find-then-delete keeps every statement bounded.
  async function purgeChunked(
    table: 'scheduledPin' | 'apiCallLog' | 'auditLog' | 'passwordResetOtp' | 'pinAnalyticsDaily',
    where: any,
    label: string,
  ): Promise<number> {
    let deleted = 0
    while (true) {
      const rows = await (db[table] as any).findMany({
        where,
        select: { id: true },
        take: PURGE_CHUNK,
        orderBy: { id: 'asc' },
      })
      if (rows.length === 0) break
      const res = await (db[table] as any).deleteMany({ where: { id: { in: rows.map((r: any) => r.id) } } })
      deleted += res.count
      if (rows.length < PURGE_CHUNK) break
      await new Promise((r) => setTimeout(r, 200)) // breathe between chunks
    }
    if (deleted > 0) console.log(`[purge] ${label}: removed ${deleted} rows`)
    return deleted
  }

  // 1) Final-status pins past retention (analytics rows cascade along)
  const pinCutoff = new Date(now - PIN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  totalPurged += await purgeChunked(
    'scheduledPin',
    { status: { in: ['published', 'canceled', 'failed_final'] }, updatedAt: { lt: pinCutoff } },
    `final pins > ${PIN_RETENTION_DAYS}d`,
  )

  // 2) Import batches past retention. Deleted in small groups so each
  //    statement's cascade (rows of that batch) stays bounded.
  const importCutoff = new Date(now - IMPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  let batchesDeleted = 0
  while (true) {
    const oldBatches = await db.importBatch.findMany({
      where: { createdAt: { lt: importCutoff } },
      select: { id: true },
      take: 10,
      orderBy: { createdAt: 'asc' },
    })
    if (oldBatches.length === 0) break
    const res = await db.importBatch.deleteMany({ where: { id: { in: oldBatches.map((b) => b.id) } } })
    batchesDeleted += res.count
    await new Promise((r) => setTimeout(r, 250))
  }
  if (batchesDeleted > 0) console.log(`[purge] import batches > ${IMPORT_RETENTION_DAYS}d: removed ${batchesDeleted} batches (+ rows via cascade)`)

  // 3) API call logs
  const apiLogCutoff = new Date(now - API_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  totalPurged += await purgeChunked('apiCallLog', { createdAt: { lt: apiLogCutoff } }, `api call logs > ${API_LOG_RETENTION_DAYS}d`)

  // 4) Audit logs
  const auditCutoff = new Date(now - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  totalPurged += await purgeChunked('auditLog', { createdAt: { lt: auditCutoff } }, `audit logs > ${AUDIT_LOG_RETENTION_DAYS}d`)

  // 5) Dead OTPs
  const otpCutoff = new Date(now - 24 * 60 * 60 * 1000)
  totalPurged += await purgeChunked('passwordResetOtp', { expiresAt: { lt: otpCutoff } }, 'expired OTPs')

  // 6) Legacy PinAnalyticsDaily cache rows past the pin retention window.
  totalPurged += await purgeChunked(
    'pinAnalyticsDaily',
    { date: { lt: new Date(now - PIN_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
    `legacy analytics cache rows > ${PIN_RETENTION_DAYS}d`,
  )

  console.log(`[purge] Completed — ${totalPurged} direct rows + ${batchesDeleted} batches removed`)
}

// Decide (with the other worker replicas, via Redis) whether this replica
// should run today's purge, then run it. Cheap to call frequently: the
// common path is one GET + one comparison.
async function maybeRunPurge(force = false) {
  try {
    if (!force) {
      const lastRun = await connection.get(PURGE_LAST_RUN_KEY)
      if (lastRun && now() - parseInt(lastRun, 10) < PURGE_MIN_GAP_MS) return // someone ran it recently
    }
    if (await connection.get(PURGE_LOCK_KEY)) return // another replica is mid-purge right now

    const token = randomUUID()
    const acquired = await connection.set(PURGE_LOCK_KEY, token, 'PX', PURGE_LOCK_TTL_MS, 'NX')
    if (acquired !== 'OK') return // lost the race to another replica

    try {
      await purgeOldData()
      await connection.set(PURGE_LAST_RUN_KEY, String(now()))
    } finally {
      await releaseLock(PURGE_LOCK_KEY, token)
    }
  } catch (err: any) {
    console.error('[purge] Failed (will retry on next check):', err.message)
  }
}

function now(): number {
  return Date.now()
}

async function releaseLock(key: string, token: string) {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `
  await connection.eval(script, 1, key, token).catch(() => {})
}

// ─── Disk Usage Monitor (small-disk early warning) ─────────────────
async function getDiskUsagePercent(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('df', ['-k', '/'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        const lines = stdout.trim().split('\n')
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/)
          if (parts.length >= 6 && parts[5] === '/') {
            const pct = parseInt(parts[4], 10) // "83%" → 83
            return resolve(isNaN(pct) ? null : pct)
          }
        }
      } catch {
        /* fall through */
      }
      resolve(null)
    })
  })
}

let cachedDiskPercent: number | null = null

async function checkDisk() {
  const pct = await getDiskUsagePercent()
  cachedDiskPercent = pct
  if (pct !== null && pct >= DISK_WARN_PERCENT && Date.now() - lastDiskWarnAt > 60 * 60 * 1000) {
    lastDiskWarnAt = Date.now()
    console.warn(`[disk] WARNING: root filesystem at ${pct}% (threshold ${DISK_WARN_PERCENT}%). Consider lowering retention (PIN_RETENTION_DAYS / IMPORT_RETENTION_DAYS) or pruning old Docker volumes/images.`)
  }
}

// ─── BullMQ Worker ───────────────────────────────────────────────────
// concurrency = how many jobs this process pulls off the queue in parallel.
// Real per-account pacing still comes from the per-connection lock in the
// publisher, NOT from this number — raising concurrency just lets more
// DIFFERENT accounts run at once.
const worker = new Worker(
  PIN_QUEUE_NAME,
  async (job) => {
    try {
      await processJob(publisherDeps, job)
    } catch (error: any) {
      console.error(`[worker] Job ${job.id} crashed:`, error.message)
      const { pinId } = job.data as { pinId: string }
      // Bounded: a pin that crashes the job every time (bad row, deleted
      // relation…) must end in failed_final instead of looping forever.
      try {
        const row = await db.scheduledPin.findUnique({ where: { id: pinId }, select: { attemptCount: true, status: true } })
        if (row && (row.status === 'queued' || row.status === 'publishing' || row.status === 'retry_waiting')) {
          const next = row.attemptCount + 1
          if (next >= MAX_RETRIES) {
            await db.scheduledPin.update({ where: { id: pinId }, data: { status: 'failed_final', attemptCount: next, lastError: `Worker error: ${error.message}` } })
          } else {
            await db.scheduledPin.update({
              where: { id: pinId },
              data: { status: 'retry_waiting', attemptCount: next, scheduledFor: new Date(Date.now() + 15000), dispatchedAt: null, lastError: `Worker error: ${error.message}` },
            })
            await scheduleFollowUp(publisherDeps, pinId, 15000)
          }
        }
      } catch {
        /* DB itself is down — the dispatcher recovers the pin once it is back */
      }
    }
  },
  { connection, concurrency: CONCURRENCY }
)

worker.on('error', (err) => console.error('[worker] BullMQ worker error:', err.message))

// ─── HTTP Health Server ─────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://localhost:${WORKER_PORT}`)
  res.setHeader('Content-Type', 'application/json')

  if (url.pathname === '/health') {
    const [counts, redisStats, ping] = await Promise.all([
      pinQueue.getJobCounts('waiting', 'delayed', 'active', 'failed').catch(() => null),
      getRedisStats(),
      dbPingMs(),
    ])
    res.end(JSON.stringify({
      status: 'ok',
      service: 'pin-desk-worker',
      queue: counts,
      concurrency: CONCURRENCY,
      uptime: process.uptime(),
      // ── Dispatcher (48h horizon) ──
      dispatcher: {
        intervalMs: config.dispatchIntervalMs,
        horizonHours: config.schedulingHorizonMs / 3600_000,
        batch: config.dispatchBatch,
        ...dispatcherMetrics,
      },
      // Redis connection + memory health — with noeviction, hitting
      // maxmemory makes job writes fail VISIBLE here before pins go missing.
      redis: {
        ...redisStats,
        connectionsInThisProcess: 2, // 1 shared command connection + 1 BullMQ blocking connection
      },
      db: { pingMs: ping },
      disk: {
        percent: cachedDiskPercent,
        warning: cachedDiskPercent !== null && cachedDiskPercent >= DISK_WARN_PERCENT,
      },
      retention: { pinsDays: PIN_RETENTION_DAYS, importsDays: IMPORT_RETENTION_DAYS, apiLogsDays: API_LOG_RETENTION_DAYS },
    }))
    return
  }
  // POST control endpoints (/trigger, /purge, /dispatch) are operator-only.
  // Require WORKER_CONTROL_TOKEN (x-worker-token header); with no token
  // configured they are disabled entirely.
  const isControl = req.method === 'POST' && (url.pathname === '/trigger' || url.pathname === '/purge' || url.pathname === '/dispatch')
  if (isControl) {
    const expected = process.env.WORKER_CONTROL_TOKEN
    if (!expected || req.headers['x-worker-token'] !== expected) {
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
  }
  if (url.pathname === '/trigger' && req.method === 'POST') {
    dispatchOnceSafe(dispatcherDeps, dispatcherMetrics).catch((e) => console.error('[worker] Manual dispatch failed:', e.message))
    res.end(JSON.stringify({ triggered: true }))
    return
  }
  if (url.pathname === '/dispatch' && req.method === 'POST') {
    // Alias of /trigger with an await — returns the cycle's metrics so
    // operators (and tests) can verify the dispatcher directly.
    try {
      await dispatchOnceSafe(dispatcherDeps, dispatcherMetrics)
      res.end(JSON.stringify({ triggered: true, dispatcher: dispatcherMetrics }))
    } catch (e: any) {
      res.statusCode = 500
      res.end(JSON.stringify({ triggered: false, error: e?.message }))
    }
    return
  }
  if (url.pathname === '/purge' && req.method === 'POST') {
    // Manual purge trigger — ignores the 20h min-gap guard (used to test
    // retention / verify the purge job after deploy). Still respects the
    // cross-replica lock so two replicas can't purge simultaneously.
    maybeRunPurge(true).catch((e) => console.error('[worker] Manual purge failed:', e.message))
    res.end(JSON.stringify({ triggered: true }))
    return
  }
  res.end(JSON.stringify({ message: 'Pin Desk Worker (BullMQ + 48h dispatcher)' }))
})
server.listen(WORKER_PORT, () => console.log(`[worker] HTTP health server on port ${WORKER_PORT}`))

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  try {
    await dispatchOnceSafe(dispatcherDeps, dispatcherMetrics)
  } catch (error: any) {
    console.error('[worker] Initial dispatch cycle failed on startup, continuing anyway:', error.message)
  }

  // Run one purge pass on startup (the Redis lock + last-run guard make
  // this a cheap no-op if another replica already purged today).
  maybeRunPurge().catch(() => {})
  checkDisk().catch(() => {})

  console.log(`[worker] Started. BullMQ concurrency=${CONCURRENCY}, per-connection lock=90s`)
  console.log(`[worker] Dispatcher: every ${config.dispatchIntervalMs}ms, horizon=${config.schedulingHorizonMs / 3600_000}h, claim batch=${config.dispatchBatch} (Postgres is source of truth)`)
  console.log(`[worker] Retention: pins=${PIN_RETENTION_DAYS}d, imports=${IMPORT_RETENTION_DAYS}d, apiLogs=${API_LOG_RETENTION_DAYS}d, auditLogs=${AUDIT_LOG_RETENTION_DAYS}d (auto-purge ~daily)`)
  setInterval(() => {
    dispatchOnceSafe(dispatcherDeps, dispatcherMetrics).catch((error: any) => console.error('[worker] Dispatch cycle error:', error.message))
  }, config.dispatchIntervalMs)
  setInterval(() => {
    maybeRunPurge().catch((error: any) => console.error('[worker] Purge check error:', error.message))
  }, PURGE_CHECK_INTERVAL_MS)
  setInterval(() => {
    checkDisk().catch(() => {})
  }, DISK_CHECK_INTERVAL_MS)
}

process.on('unhandledRejection', (reason: any) => {
  console.error('[worker] Unhandled rejection (worker stays alive):', reason?.message || reason)
})
process.on('uncaughtException', (error: any) => {
  console.error('[worker] Uncaught exception (worker stays alive):', error?.message || error)
})

// ─── Graceful shutdown (SIGTERM/SIGINT — docker stop / Coolify deploy) ──
// Docker sends SIGTERM, waits stop_grace_period (30s in compose), then
// SIGKILL. Closing in this order means: stop pulling NEW jobs → finish or
// hand back in-flight jobs (the dispatcher re-queues anything interrupted)
// → close the HTTP health server → close the queue → QUIT the shared Redis
// connection cleanly → disconnect Prisma.
let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${signal} received — shutting down gracefully`)

  // Hard deadline: exit even if something hangs (compose gives us 30s).
  const forceTimer = setTimeout(() => {
    console.error('[worker] Graceful shutdown timed out after 20s — forcing exit')
    process.exit(1)
  }, 20_000)
  forceTimer.unref?.()

  try {
    await worker.close() // stops fetching new jobs; active jobs get settled
    console.log('[worker] BullMQ worker closed')
  } catch (e: any) {
    console.error('[worker] worker.close error:', e?.message)
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    setTimeout(resolve, 2_000).unref?.()
  })
  console.log('[worker] HTTP health server closed')

  try {
    await pinQueue.close()
    console.log('[worker] BullMQ queue closed')
  } catch (e: any) {
    console.error('[worker] queue.close error:', e?.message)
  }

  try {
    await connection.quit()
    console.log('[worker] Redis connection closed cleanly')
  } catch {
    try { connection.disconnect() } catch { /* already gone */ }
  }

  try {
    await db.$disconnect()
    console.log('[worker] Prisma disconnected')
  } catch { /* best effort */ }

  clearTimeout(forceTimer)
  console.log('[worker] Shutdown complete — bye')
  process.exit(0)
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM') })
process.on('SIGINT', () => { void gracefulShutdown('SIGINT') })

main()
