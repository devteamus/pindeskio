#!/bin/sh
set -e

echo "[entrypoint] Running prisma migrate deploy..."
npx prisma migrate deploy

# ALWAYS run the seed — it is fully idempotent:
#   - Plans are upserted, so plan price/limit changes in seed.ts ALWAYS reach
#     the database (this used to be skipped when users existed, which left
#     stale plan data in the DB → dashboard showed old plans/prices).
#   - The admin user is only created when missing (upsert with update: {}),
#     so existing admins keep their changed passwords/roles.
echo "[entrypoint] Running idempotent seed (plans upsert + admin ensure)..."
npx tsx prisma/seed.ts

echo "[entrypoint] Starting server..."
# The pin-publishing worker runs as its OWN container/service now (see
# docker-compose.yml's `worker` service, BullMQ + Redis). It is no longer
# spawned in-process here — that was a SQLite-era workaround to share one
# file's path; with Postgres + Redis the worker scales independently and
# doesn't need to live inside this container at all.
exec node server.js
