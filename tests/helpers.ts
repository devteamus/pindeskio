// ─── Shared test helpers ──────────────────────────────────────────────
// Real PostgreSQL + real Redis (started by scripts/test-infra-start.sh).
// Each test file uses its OWN BullMQ queue name so files can run in
// parallel without interfering; each test truncates the pin tables and
// flushes its queue for isolation.

import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { WorkerConfig, emptyMetrics, DispatcherMetrics } from '../worker/context'
import { DispatcherDeps } from '../worker/dispatcher'
import { PublisherDeps } from '../worker/publisher'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://z@127.0.0.1:5433/pindesk_test'
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6380'

// Fixed seed ids (idempotent upserts)
export const SEED = {
  userId: 'test-user-000001',
  planFreeId: 'plan_free',
  planProId: 'test-plan-pro-0001',
  connectionId: 'test-conn-000001',
  boardId: 'test-board-000001',
  user2Id: 'test-user-000002',
  connection2Id: 'test-conn-000002',
}

export function testConfig(queueName: string, overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    queueName,
    schedulingHorizonMs: 48 * 60 * 60 * 1000,
    dispatchIntervalMs: 30_000,
    dispatchBatch: 500,
    maxDispatchPerCycle: 2000,
    dispatchSweepChunk: 500,
    maxSweepChunks: 4,
    dispatchCycleBudgetMs: 10_000,
    earlyGraceMs: 60_000,
    orphanRecoveryMs: 2 * 60 * 1000,
    ...overrides,
  }
}

export async function makeDeps(queueName: string, overrides: Partial<WorkerConfig> = {}) {
  const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } })
  const connection = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
  const config = testConfig(queueName, overrides)
  const queue = new Queue(queueName, { connection })
  const dispatcherDeps: DispatcherDeps = { db, queue, connection, config }
  const publisherDeps: PublisherDeps = { db, queue, connection, config }
  return { db, connection, queue, config, dispatcherDeps, publisherDeps }
}

export type TestDeps = Awaited<ReturnType<typeof makeDeps>>

export async function closeDeps(deps: TestDeps) {
  await deps.queue.close().catch(() => {})
  await deps.connection.quit().catch(() => {})
  await deps.db.$disconnect().catch(() => {})
}

/** Idempotent base data: user, plans, connections, board. */
export async function seedBase(db: PrismaClient) {
  await db.plan.upsert({
    where: { id: SEED.planFreeId },
    create: {
      id: SEED.planFreeId,
      name: 'Free',
      maxConnectedAccounts: 1,
      monthlyPinQuota: 100,
      dailyPinLimit: 10,
      maxRowsPerImport: 50,
      priceUsd: 0,
    },
    update: {},
  })
  await db.plan.upsert({
    where: { id: SEED.planProId },
    create: {
      id: SEED.planProId,
      name: 'Pro (test)',
      maxConnectedAccounts: 3,
      monthlyPinQuota: 1000,
      dailyPinLimit: 10,
      maxRowsPerImport: 5000,
      priceUsd: 9.99,
    },
    update: {},
  })
  for (const [userId, connectionId] of [
    [SEED.userId, SEED.connectionId],
    [SEED.user2Id, SEED.connection2Id],
  ] as const) {
    await db.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@example.com`,
        name: userId,
        role: 'user',
        status: 'active',
        currentPlanId: SEED.planProId,
      },
      update: { status: 'active', currentPlanId: SEED.planProId },
    })
    await db.pinterestConnection.upsert({
      where: { id: connectionId },
      create: {
        id: connectionId,
        userId,
        accessToken: 'simulated_test_token',
        status: 'active',
      },
      update: { status: 'active', accessToken: 'simulated_test_token' },
    })
  }
  await db.pinterestBoard.upsert({
    where: { id: SEED.boardId },
    create: {
      id: SEED.boardId,
      connectionId: SEED.connectionId,
      pinterestBoardId: '999111999',
      boardName: 'Test Board',
    },
    update: {},
  })
}

/** Wipe everything that a single test could have dirtied. */
export async function cleanSlate(deps: TestDeps) {
  await deps.db.$executeRawUnsafe(`TRUNCATE TABLE "ScheduledPin", "UsageCounter", "ApiCallLog", "PinAnalyticsDaily", "ImportRow", "ImportBatch" CASCADE`)
  const prefix = `bull:${deps.config.queueName}`
  const keys = await deps.connection.keys(`${prefix}:*`).catch(() => [] as string[])
  const lockKeys = await deps.connection.keys('lock:conn:*').catch(() => [] as string[])
  const all = [...keys, ...lockKeys, 'bull:pin-publish:*']
  const appQueueKeys = await deps.connection.keys('bull:pin-publish:*').catch(() => [] as string[])
  for (const k of new Set([...all, ...appQueueKeys])) {
    await deps.connection.del(k).catch(() => {})
  }
}

/** Delete all Redis keys matching a prefix (used by app-queue tests). */
export async function cleanSlateByPrefix(connection: IORedis, prefix: string) {
  const keys = await connection.keys(`${prefix}*`).catch(() => [] as string[])
  for (const k of keys) await connection.del(k).catch(() => {})
}

let pinSeq = 0
/** Create a scheduled pin with sensible defaults for tests. */
export async function createPin(
  db: PrismaClient,
  overrides: Partial<{
    id: string
    userId: string
    connectionId: string
    boardId: string
    scheduledFor: Date | null
    status: string
    dispatchedAt: Date | null
    attemptCount: number
    consecutiveRateLimits: number
    payloadJson: string
    publishedAt: Date | null
    updatedAt: Date
  }> = {},
) {
  pinSeq++
  return db.scheduledPin.create({
    data: {
      id: overrides.id ?? `pin-test-${Date.now()}-${pinSeq}`,
      userId: overrides.userId ?? SEED.userId,
      connectionId: overrides.connectionId ?? SEED.connectionId,
      boardId: overrides.boardId ?? null,
      title: `Test pin ${pinSeq}`,
      description: null,
      destinationUrl: null,
      imageUrl: 'https://example.com/img.png',
      altText: null,
      scheduledFor: overrides.scheduledFor ?? new Date(),
      status: overrides.status ?? 'queued',
      dispatchedAt: overrides.dispatchedAt ?? null,
      attemptCount: overrides.attemptCount ?? 0,
      consecutiveRateLimits: overrides.consecutiveRateLimits ?? 0,
      payloadJson: overrides.payloadJson ?? JSON.stringify({
        title: 'Test pin',
        board_id: '999111999',
        media_source: { source_type: 'image_url', url: 'https://example.com/img.png' },
      }),
      publishedAt: overrides.publishedAt ?? null,
      ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
    },
  })
}

/** Injectable fake publisher with call tracking. */
export function fakePublisher(
  impl?: (db: any, conn: any, pin: any) => Promise<import('../worker/publisher').PublishResult>,
) {
  const calls: any[] = []
  const fn = async (db: any, conn: any, pin: any) => {
    calls.push({ pinId: pin.id, at: Date.now() })
    if (impl) return impl(db, conn, pin)
    return { success: true, externalPinId: `fake_${calls.length}` }
  }
  return { fn, calls }
}

/** A minimal stand-in for a BullMQ Job (processJob only reads .data). */
export function fakeJob(pinId: string): any {
  return { data: { pinId }, id: `fake-${pinId}` }
}

export function freshMetrics(): DispatcherMetrics {
  return emptyMetrics()
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 15_000, stepMs = 100, label = 'condition' } = {},
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, stepMs))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for: ${label}`)
}

/** Count LIVE jobs for a pin: exact pinId + follow-up pinId-<ts> ids. */
export async function liveJobCountForPin(deps: TestDeps, pinId: string): Promise<number> {
  const prefix = `bull:${deps.config.queueName}`
  const [wait, active, delayed, prioritized] = await Promise.all([
    deps.connection.lrange(`${prefix}:wait`, 0, -1).catch(() => [] as string[]),
    deps.connection.lrange(`${prefix}:active`, 0, -1).catch(() => [] as string[]),
    deps.connection.zrange(`${prefix}:delayed`, 0, -1).catch(() => [] as string[]),
    deps.connection.zrange(`${prefix}:prioritized`, 0, -1).catch(() => [] as string[]),
  ])
  const all = [...wait, ...active, ...delayed, ...prioritized]
  return all.filter((id) => id === pinId || (id.startsWith(pinId + '-') && /^\d+$/.test(id.slice(pinId.length + 1)))).length
}
