// ─── Worker shared context & configuration ──────────────────────────
// Split out of index.ts so the dispatcher and publisher modules (and the
// test suite) can be constructed with injected dependencies instead of
// reaching for module-level singletons.

export interface WorkerConfig {
  /** BullMQ queue name — must match the app's src/lib/queue.ts */
  queueName: string
  /** 48-hour scheduling horizon (ms). Pins due further out than this stay
   *  in PostgreSQL only; the dispatcher enqueues them as they slide in. */
  schedulingHorizonMs: number
  /** How often the dispatcher cycle runs (ms) */
  dispatchIntervalMs: number
  /** Max pins claimed (atomically) per dispatcher cycle */
  dispatchBatch: number
  /** Upper bound of pins one dispatcher cycle may enqueue in total */
  maxDispatchPerCycle: number
  /** Chunk size of the due-sweep DB query */
  dispatchSweepChunk: number
  /** Max chunks the due-sweep will walk per cycle (bound: chunk × chunks) */
  maxSweepChunks: number
  /** Soft time budget for one dispatcher cycle (ms) — the cycle yields early */
  dispatchCycleBudgetMs: number
  /** A job firing this much BEFORE scheduledFor is re-deferred, not published */
  earlyGraceMs: number
  /** Orphaned 'publishing' pins older than this are recovered (ms) */
  orphanRecoveryMs: number
}

export function loadWorkerConfigFromEnv(): WorkerConfig {
  const horizonHours = Math.max(1, parseFloat(process.env.SCHEDULING_HORIZON_HOURS || '48'))
  return {
    queueName: process.env.PIN_QUEUE_NAME || 'pin-publish',
    schedulingHorizonMs: horizonHours * 60 * 60 * 1000,
    dispatchIntervalMs: Math.max(5000, parseInt(process.env.DISPATCH_INTERVAL_MS || '30000', 10)),
    dispatchBatch: Math.max(1, parseInt(process.env.DISPATCH_BATCH || '500', 10)),
    maxDispatchPerCycle: Math.max(1, parseInt(process.env.MAX_DISPATCH_PER_CYCLE || '2000', 10)),
    dispatchSweepChunk: Math.max(1, parseInt(process.env.DISPATCH_SWEEP_CHUNK || '500', 10)),
    maxSweepChunks: Math.max(1, parseInt(process.env.MAX_SWEEP_CHUNKS || '4', 10)),
    dispatchCycleBudgetMs: Math.max(1000, parseInt(process.env.DISPATCH_CYCLE_BUDGET_MS || '10000', 10)),
    earlyGraceMs: Math.max(0, parseInt(process.env.EARLY_GRACE_MS || '60000', 10)),
    orphanRecoveryMs: 2 * 60 * 1000,
  }
}

export interface DispatcherMetrics {
  /** epoch ms of the last completed cycle */
  lastRunAt: number | null
  /** wall-clock duration of the last cycle (ms) */
  lastDurationMs: number
  /** DB latency of the last cycle's claim queries (ms, max seen) */
  lastDbMs: number
  /** pins claimed (atomically) in the last cycle */
  lastClaimed: number
  /** jobs actually enqueued by the claim path in the last cycle */
  lastEnqueued: number
  /** due/overdue pins re-ensured by the due-sweep in the last cycle */
  lastSwept: number
  /** orphaned 'publishing' pins recovered in the last cycle */
  lastRecoveredOrphans: number
  /** paused pins resumed (plan renewed / quota available) in the last cycle */
  lastResumed: number
  /** Redis enqueue failures in the last cycle (pins pushed back to dispatchedAt=NULL) */
  lastEnqueueFailures: number
  /** longest cycle since process start (ms) */
  maxDurationMs: number
  /** how many cycles exceeded their time budget since start */
  slowCycles: number
  /** total cycles run */
  cycles: number
  /** last error message, if a cycle threw */
  lastError: string | null
}

export function emptyMetrics(): DispatcherMetrics {
  return {
    lastRunAt: null,
    lastDurationMs: 0,
    lastDbMs: 0,
    lastClaimed: 0,
    lastEnqueued: 0,
    lastSwept: 0,
    lastRecoveredOrphans: 0,
    lastResumed: 0,
    lastEnqueueFailures: 0,
    maxDurationMs: 0,
    slowCycles: 0,
    cycles: 0,
    lastError: null,
  }
}
