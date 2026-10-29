import { PrismaClient } from '@prisma/client'
import { config } from './config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prisma's default pool is only (CPU cores × 2 + 1) connections. Under load the
// app queues requests behind that tiny pool and fails with
// "Timed out fetching a new connection from the connection pool". Size it
// explicitly (env DB_POOL_SIZE, default 10) unless DATABASE_URL already sets
// connection_limit. Keep (app pool + worker replicas × WORKER_DB_POOL) below
// Postgres max_connections (default 100).
function withPoolParams(url: string): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', process.env.DB_POOL_SIZE || '10')
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '20')
    return u.toString()
  } catch {
    return url
  }
}

// PostgreSQL handles concurrent writers from multiple processes (web + worker,
// and multiple worker replicas) natively via MVCC — no WAL pragmas or
// busy_timeout hacks needed like SQLite required.
// Cached on globalThis in every environment so a module loaded twice can never
// open a second connection pool.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: withPoolParams(config.databaseUrl),
    log: config.isProduction ? ['error'] : ['query', 'error'],
  })

globalForPrisma.prisma = db
