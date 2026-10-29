#!/bin/sh
set -e

# Schema migrations + seeding are the APP container's job (via prisma
# migrate deploy in entrypoint.sh) — running them here too, from a second
# process, is exactly the kind of concurrent-write race we're trying to
# get away from by moving off SQLite. docker-compose's
# `depends_on: app: condition: service_healthy` already guarantees the
# app (and therefore the schema) is ready before this container starts.

echo "[worker-entrypoint] Generating Prisma client..."
cd /app && npx prisma generate

echo "[worker-entrypoint] Starting worker (BullMQ + Redis, Node runtime)..."
# Node + tsx (NOT bun): bun crashes on some VPS CPUs — for the worker that
# would mean a crash-looping container and ZERO published pins. The full
# worker module tree (dispatcher/publisher/context/index) is exercised
# under Node by the vitest suite, so this is the tested runtime.
exec npx tsx worker/index.ts
