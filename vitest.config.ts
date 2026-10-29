import { defineConfig } from 'vitest/config'
import path from 'path'

// Test env — injected BEFORE any module loads, so src/lib/queue.ts and
// src/lib/db.ts pick up the test Postgres/Redis started by
// scripts/test-infra-start.sh.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://z@127.0.0.1:5433/pindesk_test'
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6380'

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789abcdef',
      NODE_ENV: 'test',
      // Not production → simulated connections allowed for unit tests that
      // do not inject a fake publisher
      ALLOW_SIMULATED_PINS: 'true',
    },
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Real processes, real timing — no fake timers, no thread isolation
    pool: 'forks',
    maxConcurrency: 4,
    fileParallelism: false, // e2e timing tests must not fight for CPU
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
