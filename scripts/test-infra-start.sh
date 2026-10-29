#!/bin/bash
# ── Test infrastructure: local PostgreSQL + Redis for the test suite ──
# Starts (or reuses) a local Postgres + Redis, (re)creates the pindesk_test
# database, applies ALL Prisma migrations, and prints the connection URLs.
#
# Portable version for the public repo:
#   • Binaries are looked up first in .test-infra/ (repo-local, gitignored),
#     then on the system PATH (brew/apt/pacman installs work out of the box).
#   • If you already have Postgres/Redis running, skip this script entirely
#     and just export TEST_DATABASE_URL / TEST_REDIS_URL before `npm test`.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$REPO/.test-infra"
PG_PORT="${TEST_PG_PORT:-5433}"
REDIS_PORT="${TEST_REDIS_PORT:-6380}"
TEST_DB=pindesk_test
export PGUSER="${PGUSER:-$(whoami)}"
export PGADMIN_URL="postgresql://$PGUSER@127.0.0.1:$PG_PORT/postgres"
export REPO_NODE_MODULES="$REPO/node_modules"

# ── Locate binaries: repo-local .test-infra first, then PATH ──
find_bin() {
  for cand in "$@"; do
    if command -v "$cand" > /dev/null 2>&1; then
      command -v "$cand"; return 0
    fi
  done
  return 1
}

INITDB=$(find_bin "$INFRA/pg/bin/initdb" initdb) || { echo "[test-infra] initdb not found — install PostgreSQL or set TEST_DATABASE_URL to an existing server."; exit 1; }
PG_BIN="$(dirname "$INITDB")"
PG_CTL="$PG_BIN/pg_ctl"
REDIS_SERVER=$(find_bin "$INFRA/redis-server" redis-server) || { echo "[test-infra] redis-server not found — install Redis or set TEST_REDIS_URL to an existing server."; exit 1; }
REDIS_CLI="$(dirname "$REDIS_SERVER")/redis-cli"

PG_DATA="$INFRA/pgdata-test"
mkdir -p "$INFRA"

# ── PostgreSQL ──
if [ ! -d "$PG_DATA" ]; then
  echo "[test-infra] initdb at $PG_DATA"
  "$INITDB" -D "$PG_DATA" -U "$PGUSER" -E UTF8 --auth=trust > /dev/null
fi

if ! "$PG_CTL" -D "$PG_DATA" -o "-p $PG_PORT -k $INFRA -c listen_addresses=127.0.0.1" status > /dev/null 2>&1; then
  echo "[test-infra] starting postgres on :$PG_PORT"
  "$PG_CTL" -D "$PG_DATA" -l "$INFRA/pg-test.log" \
    -o "-p $PG_PORT -k $INFRA -c listen_addresses=127.0.0.1 -c max_connections=80" start > /dev/null
  for i in $(seq 1 30); do
    "$PG_BIN/psql" -h 127.0.0.1 -p $PG_PORT -U "$PGUSER" -d postgres -c "SELECT 1" > /dev/null 2>&1 && break
    sleep 0.5
  done
fi

# (re)create the test database from scratch — driven via the pg driver from
# the repo's node_modules (works even when the portable psql lacks CREATE
# DATABASE support on the running server).
node -e '
const { Client } = require(process.env.REPO_NODE_MODULES + "/pg");
(async () => {
  const c = new Client({ connectionString: process.env.PGADMIN_URL });
  await c.connect();
  await c.query("DROP DATABASE IF EXISTS pindesk_test");
  await c.query("CREATE DATABASE pindesk_test");
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
'

# ── Redis ──
if ! "$REDIS_CLI" -p $REDIS_PORT ping > /dev/null 2>&1; then
  echo "[test-infra] starting redis on :$REDIS_PORT"
  "$REDIS_SERVER" --port $REDIS_PORT --daemonize yes \
    --save '' --appendonly no --maxmemory 256mb --maxmemory-policy noeviction \
    --dir "$INFRA" --logfile "$INFRA/redis-test.log"
  for i in $(seq 1 20); do
    "$REDIS_CLI" -p $REDIS_PORT ping > /dev/null 2>&1 && break
    sleep 0.25
  done
fi
"$REDIS_CLI" -p $REDIS_PORT FLUSHALL > /dev/null

# ── Apply migrations to the test DB ──
export DATABASE_URL="postgresql://$PGUSER@127.0.0.1:$PG_PORT/$TEST_DB"
cd "$REPO"
npx prisma migrate deploy 2>&1 | tail -3

echo ""
echo "TEST_DATABASE_URL=$DATABASE_URL"
echo "TEST_REDIS_URL=redis://127.0.0.1:$REDIS_PORT"
