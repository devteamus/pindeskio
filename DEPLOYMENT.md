# Pin Desk — Scaling & Storage Deployment Guide

This update makes Pin Desk production-ready for **~200 users / ~3,300 connected
Pinterest accounts / up to ~500k pins per day** on a single 35GB VPS.

---

## What changed in this update (v8 — 48-hour scheduling horizon: PostgreSQL as source of truth)

**Context: PostgreSQL is now the source of truth for ALL future scheduled pins; Redis/BullMQ is only the execution queue for the next 48 hours.**

| # | Change | Why it matters |
|---|--------|----------------|
| 1 | **NEW: 48-hour scheduling horizon** | Before, EVERY pin got a Redis delayed job at creation — a 50k-row CSV at 1-hour intervals put 50k multi-year delayed jobs (~60 MB) in Redis, and at ~300k pending jobs the 384 MB maxmemory/noeviction cap started rejecting new job writes. Now only pins due within `SCHEDULING_HORIZON_HOURS` (default 48) are enqueued; everything else stays in Postgres until the dispatcher picks it up as it slides into the window. Redis memory is now bounded by the horizon, not by how far out users schedule |
| 2 | **NEW: recurring dispatcher in the worker** (`worker/dispatcher.ts`, every `DISPATCH_INTERVAL_MS` = 30s) | Each cycle: recovers orphaned `publishing` pins (>2 min), resumes plan-renewed/quota-available paused pins, **atomically claims** undispatched in-window pins via `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED …)` and enqueues them with deterministic `jobId = pinId`. Multiple worker replicas are safe: SKIP LOCKED gives disjoint claim sets and BullMQ's jobId dedupe makes double-adds no-ops |
| 3 | **NEW: due-sweep safety net (Redis data-loss recovery)** | Every cycle, pins whose `scheduledFor` has arrived are diffed against the live job IDs read straight from BullMQ's Redis keys (`wait`/`active`/`delayed`/`prioritized`, prefix-aware for follow-up jobs). Anything missing — Redis wiped, missed cycle, failed enqueue, lost follow-up — is re-enqueued immediately. A pin can never be permanently lost: it gets a job within one cycle of becoming due, no matter what happened to Redis |
| 4 | **NEW: `ScheduledPin.dispatchedAt` + partial index** (migration `20261027120000`) | `dispatchedAt IS NULL` means "needs a job". The partial index `(scheduledFor) WHERE status IN ('queued','retry_waiting') AND dispatchedAt IS NULL` means the dispatcher's claim query only ever touches rows that actually need dispatching — never the dispatched/published majority of the table (verified with EXPLAIN). Any schedule change resets it to NULL, re-entering the pin into the claim set |
| 5 | **FIX: `processJob` now enforces `scheduledFor` (Postgres = source of truth)** | A job that fires EARLY (stale delay after a reschedule, dispatcher race) used to publish the pin early. Now it re-defers (status kept, `dispatchedAt=NULL`) and the dispatcher re-enqueues at the correct time. Rescheduling a pin to a LATER time actually works now |
| 6 | **FIX: ambiguous API failures handled safely (at-least-once)** | Transport timeouts / connection resets / Pinterest 504s may have created the pin even though we saw an error. These are now classified `ambiguous`, retried with a longer delay (5 min default), and tagged `AMBIGUOUS (pin may already exist…)` in `lastError`. **Publishing is at-least-once — we do NOT claim exactly-once** because Pinterest's v5 API has no idempotency key for POST /pins; duplicates on ambiguous failures are documented, tagged, and reviewable |
| 7 | **FIX: resume paths respected no horizon** | The old reconciler's plan-renewal / quota-resume paths enqueued far-future pins with full delays. They now only flip status back to `queued` + `dispatchedAt=NULL` and the dispatcher owns job creation (horizon-correct) |
| 8 | **FIX: exact-mode CSV `publish_at` validation** | An unparsable `publish_at` in `exact_schedule` mode silently fell back to interval pacing. It is now a row-level validation error. Naive datetimes (no offset) are interpreted as UTC deterministically; values with explicit offsets/Z convert correctly |
| 9 | **Monitoring: dispatcher + Redis memory + DB ping on `/health`** | `/health` now reports dispatcher metrics (cycle count/duration, claimed, enqueued, swept, orphans recovered, resumed, enqueue failures, slow cycles), Redis `used_memory`/`maxmemory`/policy, and a DB ping latency. New token-protected `POST /dispatch` triggers a cycle on demand (operators + tests) |
| 10 | **Worker refactored into modules** (`worker/context.ts`, `dispatcher.ts`, `publisher.ts`) | The 1,100-line monolith is split into injectable modules — which is what made the new test suite possible. `worker/index.ts` stays the entrypoint; behavior (purge, locks, token refresh, plan/quota rules, graceful shutdown) is preserved |

**Scheduling invariants (all enforced + tested):**
- All future pins live in Postgres; Redis only holds ≤ horizon worth of jobs.
- `jobId = pinId` for primary jobs → duplicate adds are silent no-ops.
- One live job per pin at a time; the atomic claim (`queued/retry_waiting → publishing`) makes duplicate jobs harmless.
- A pin gets a job within one dispatch cycle of entering the 48h window; a due pin never waits more than one cycle for recovery.
- Publishing is at-least-once; ambiguous failures are tagged, not hidden.

**Tests added (`npm test` — vitest, real PostgreSQL 16 + real Redis 7):**
duplicate dispatch across cycles; concurrent dispatchers (SKIP LOCKED); concurrent
publishers on one pin (atomic claim — exactly one publish); Redis hard-kill restart
recovery; full `FLUSHDB` data-loss recovery; delayed execution through a real BullMQ
worker (never early, ≤1 cycle late); reschedule-while-job-live correctness; missed
dispatch cycles; horizon boundary (app producer side); orphaned `publishing` recovery;
ambiguous-failure tagging; rate-limit / retry / daily-limit / reauth / cancel regressions.
**34 tests, all passing.**

**New env vars** (all optional, defaults shown): `SCHEDULING_HORIZON_HOURS=48`,
`DISPATCH_INTERVAL_MS=30000`, `DISPATCH_BATCH=500`, `MAX_DISPATCH_PER_CYCLE=2000`,
`DISPATCH_SWEEP_CHUNK=500`, `MAX_SWEEP_CHUNKS=4`, `DISPATCH_CYCLE_BUDGET_MS=10000`,
`EARLY_GRACE_MS=60000`, `PIN_MAX_RETRIES=3`, `AMBIGUOUS_RETRY_DELAY_MS=300000`.

**Quick verification after deploy:**
1. `docker compose ps` → 4 services (app, worker, postgres, redis) all healthy
2. `curl :3001/health` → `dispatcher.horizonHours: 48`, `cycles` increasing, `lastError: null`
3. Import a CSV with pins spread over a week → `docker compose exec redis redis-cli zcard bull:pin-publish:delayed` shows ONLY the next-48h jobs (not the whole import)
4. `docker compose exec redis redis-cli info memory | grep used_memory_human` → well under 384mb
5. Pins publish on schedule (History tab); rescheduling later actually moves the publish time

---

## What changed in the previous update (v7 — 2GB stack hardening: leak fixes + resource budget)

**Context: the whole app stack (app + worker + Postgres + Redis) now has a hard 2 GB RAM budget on an 8 GB VPS.**

| # | Fix / Feature | Why it matters |
|---|---------------|---------------|
| 1 | **FIX: analytics cache was an unbounded memory leak** | `accountCache` in `pin-analytics.ts` never evicted entries; keys multiply per account × date-range and change daily. At thousands of connected accounts this grew into hundreds of MB in the app process. Now: LRU-capped at 200 entries (~5 MB) with TTL sweep + lazy expiry — same 3-minute freshness, zero behavior change for users |
| 2 | **FIX: worker fetches had NO timeout (up to 5-min hangs)** | Pin publish + token-refresh calls in `worker/index.ts` relied on Node's 300s default. A hung Pinterest connection pinned a BullMQ concurrency slot AND (if it recovered after >2 min) could double-publish after the reconciler re-queued the pin. All 3 calls now abort at 30s (token refresh 20s) — well under the 2-min orphan window |
| 3 | **FIX: 5 app-side Pinterest calls + Resend email had no timeout** | `exchangeCodeForToken`, `getPinterestUser`, `fetchPinterestBoards`, `createPinterestBoard`, `createPinterestPin` (pinterest.ts) and the Resend fetch (email.ts) could hang their routes for minutes. All now 10-30s `AbortSignal.timeout` |
| 4 | **FIX: bulk import built unbounded response arrays** | `previewRows` + `errorSamples` materialized one object per CSV row (50k on the biggest import) only to return the first 200/50. Now capped at build time — identical HTTP response, bounded import memory. Board-id lookup per row (`boards.find`) also became an O(1) Map lookup |
| 5 | **NEW: 2 justified indexes** (migration `20261020000000`) | `ScheduledPin(status, updatedAt)` — the daily purge's chunked delete loop and the reconciler's orphan scan filter exactly on this pair; before it, each purge iteration re-visited a large share of the table. `PinterestConnection(userId)` — every dashboard/analytics/OAuth lookup filters by userId on an unindexed FK |
| 6 | **Docker memory+CPU limits on ALL services** | app 640M (Node heap capped at 384 MB via `NODE_OPTIONS`), worker 320M, postgres 384M, redis 576M → **total 1920 MB < 2 GB budget** with hard ceilings, so one runaway process can never eat the VPS. Steady-state measured: ~270 MB total |
| 7 | **Redis maxmemory 3gb → 384mb default** | The old default alone exceeded the entire 2 GB stack budget (and the VPS runs other apps). 384mb ≈ 300k+ pending jobs at ~1.2 KB each — matches the 100-user / 5k-account target. `noeviction` kept: overflow fails loudly, reconciler recovers |
| 8 | **ONE worker replica (was 3), concurrency 50 → 25, worker DB pool 20 → 15** | 3 worker replicas cost ~+400 MB for capacity the target doesn't need (25 concurrent × ~1-2s/pin ≈ 40k+ pins/hour). Compose comment explains exactly how to re-add replicas on a bigger VPS. Pools now 10 + 15 = 25 << `max_connections=60` |
| 9 | **Postgres tuned: `max_connections=60`, `shared_buffers=128MB`** | Hard guard on per-connection RAM (~5-10 MB each); pools only need ~25 |
| 10 | **Worker healthcheck added** | `wget :3001/health` every 30s — Coolify/Docker restart the worker if its event loop dies (app/pg/redis already had checks) |

**Verification performed (real PostgreSQL 16 + Redis 8, real production build):**
all 8 migrations applied cleanly on a fresh DB; seed OK; new indexes confirmed present;
register → login → connect → 6-row CSV import (5 valid / 1 invalid / 900-char description truncated to 800 both in DB and payloadJson);
worker published the due pin exactly once; no duplicate externalPinIds; an orphaned `publishing` pin was
recovered by the reconciler; worker `/health` reports queue+redis+disk; worker survived 25 min-equivalent
of dead Redis + dead DB without crashing; process RSS measured at ~275 MB total. LRU cache logic unit-tested (cap, eviction order, TTL sweep, LRU refresh, bounded bytes).

**Quick verification after deploy:**
1. `docker compose ps` → 4 services (app, worker, postgres, redis) all healthy
2. `docker stats --no-stream` → all containers far below their memory limits
3. `docker compose exec redis redis-cli info memory | grep used_memory_human` → well under 384mb
4. Import a CSV → pins publish on schedule (History tab)
5. `docker compose logs worker` → no repeated Redis/queue errors

---

## What changed in the previous update (v6 — live Board stats + Pinterest text limits + landing pricing + Redis hardening)

| # | Fix / Feature | Why it matters |
|---|---------------|----------------|
| 1 | **Boards tab: "Boards with Pins" and "Total Pins on Boards" now show REAL numbers** | Root cause: Pinterest v5 `GET /v5/boards` returns the pin count in `pin_count`, but the sync read `board_pin_count` → every board was saved with `pinCount=0`. Now BOTH field names are accepted (`pin_count` primary, `board_pin_count` fallback) so live counts persist correctly |
| 2 | **Boards tab auto-syncs live from Pinterest** | `GET /api/boards` now refreshes from the Pinterest API (token refresh under the same worker lock) whenever the cached board data is older than 3 minutes — opening the tab shows live counts without clicking Sync. Any API error silently falls back to the last cached numbers |
| 3 | **Pinterest text limits enforced (title 100 / description 800 / alt_text 500)** | Long CSV descriptions (common with Bengali article text) used to reach Pinterest and fail with `400 "…is too long (constraint: maxLength=800)"`. Now trimmed at CSV import, at single-pin creation, AND in the worker as a final safety net — already-queued legacy pins publish fine too |
| 4 | **Bulk import response reports `truncatedRows`** | How many text fields were trimmed to fit Pinterest's limits, so uploads never fail silently on long text |
| 5 | **Landing page pricing updated with the new features** | Free: "Create boards & board sync" · Pro: "Create boards & live board sync" + "Pinterest organic analytics" · Agency: "Board manager & live sync" + "Advanced organic analytics". The seed's plan features (dashboard Plan tab) match — self-heals on next boot |
| 6 | **Worker graceful shutdown (SIGTERM/SIGINT)** | On `docker stop`/Coolify redeploys the worker now closes BullMQ worker → HTTP health server → queue → Redis (clean QUIT) → Prisma, with a 20s force-exit deadline. `stop_grace_period: 30s` added to all worker services |
| 7 | **Redis connection monitoring in worker `/health`** | New `redis: { status, connectedClients, blockedClients, connectionsInThisProcess }` read from `INFO` on the EXISTING connection (never creates new ones) — watch `connected_clients` to detect any future connection leak early |
| 8 | **Redis connection audit: NO leak found** | Verified: app + worker use ONE singleton Redis connection + ONE singleton BullMQ queue each; `/api/health` never touches Redis; the worker health endpoint reuses the same queue instance; 10k-row CSVs enqueue via chunked `addBulk` on the shared queue (jobs ≠ connections) |

**No migration, no new env vars, no UI redesign.**

**Quick verification after deploy:**
1. Boards tab → pick a real connected account → the 3 stat cards show live totals (auto-syncs on open; "Sync Live from Pinterest" forces an immediate refresh)
2. Upload a CSV containing a 900+ character description → the import summary reports truncated fields; every pin publishes (no more maxLength 400s in Failed pins)
3. `docker compose stop worker` → logs show `SIGTERM received — shutting down gracefully` … `Shutdown complete`
4. `curl http://localhost:3001/health` on a worker → `redis.connectedClients` is visible and stays flat over time

---

## What changed in the previous update (v5 — REAL Pinterest Organic Analytics)

| # | Fix / Feature | Why it matters |
|---|---------------|----------------|
| 1 | **Analytics now fetches REAL data from the official Pinterest v5 Organic Analytics API** | Account-level metrics come from `GET /v5/user_account/analytics` (IMPRESSION, PIN_CLICK, OUTBOUND_CLICK, SAVE, ENGAGEMENT, ENGAGEMENT_RATE) using each connected account's own OAuth access token. **No mock/simulated numbers, no deriving Pinterest metrics from the local database** — the only local counts left are the tool's own operational stats ("Pins Published" = pins PinDesk published, "API Calls" = calls PinDesk made) |
| 2 | **Top 5 Pins from `GET /v5/user_account/analytics/top_pins`** | Real Pinterest ranking (sorted by ENGAGEMENT, falls back to IMPRESSION for legacy tokens), real per-pin metrics, real pin images/titles/links straight from the API response |
| 3 | **`GET /v5/pins/{pin_id}/analytics` helper** | Available in `src/lib/pin-analytics.ts` (`fetchPinAnalytics`) for whenever individual pin-level analytics are needed — parses `daily_metrics` + `summary_metrics` |
| 4 | **OLD broken flow removed** | Previously the Analytics tab looped over up to 500 pins calling the per-pin endpoint on every page view (instant rate-limit) and invented `simulatedMetricsFor()` numbers for demo connections. Both are gone |
| 5 | **Multi-account aggregation done right** | Metrics are summed across ALL connected accounts (or the one selected in the Account dropdown); Top 5 pins are merged and re-ranked across accounts. One failing account (429/5xx) never breaks the page — its error is surfaced as a small note while other accounts still report |
| 6 | **Token refresh under the worker's Redis lock** | Analytics fetches refresh expiring access tokens through the SAME per-connection lock the worker uses (no refresh-token race). Dead refresh tokens auto-flag the connection as "reconnect needed" |
| 7 | **Pinterest quirks handled** | end_date capped at yesterday (organic data is delayed up to ~2 days), 90-day window cap, 400-fallback to the classic 4 metric types for older tokens, defensive parsing of both flat and nested response layouts, 3-minute in-memory cache per account+range to respect rate limits |
| 8 | **CSV export uses the same real data** | Daily rows come from Pinterest's `daily_metrics` (+ PinDesk's own pins-published/API-call counts per day). Same columns as before |
| 9 | **Legacy `PinAnalyticsDaily` cache table cleaned up** | The worker's daily purge now deletes stale rows from the old analytics cache table (nothing writes it anymore) |

**No migration, no new env vars, no UI redesign** — the Analytics tab looks the
same; only the DATA is now real. A small status line appears when relevant:
"Live from Pinterest organic analytics · data through YYYY-MM-DD" (Pinterest's
reported delay), reconnect warnings, or rate-limit notes.

**Quick verification after deploy:**
1. Open the dashboard → Analytics → pick a REAL connected account (or All Accounts)
2. Metric cards show your actual Pinterest organic numbers; Top 5 Pins show real pins with real images
3. Note the "data through YYYY-MM-DD" line — Pinterest reports organic analytics with a delay of up to ~2 days, so the most recent day(s) may not be included yet
4. Demo/simulated connections show zeros + a "connect a real Pinterest account" note (no fake data, by design)
5. CSV export totals match the cards

---

## What changed in the previous update (v4 — Create Board + 3 workers + reload fix)

| # | Fix / Feature | Why it matters |
|---|---------------|----------------|
| 1 | **NEW: Boards tab with "Create a Board"** | Users can now create Pinterest boards directly from the dashboard: pick ANY connected account from the dropdown, enter name/description/privacy (Public/Secret) — the board is created on Pinterest via the official API and is instantly available for scheduling. Duplicate-name guard, length validation (180/500), 429 & reauth handling included |
| 2 | **Live board stats per account** | The Boards tab shows Total Boards / Boards with Pins / Total Pins, plus per-board live pin counts (`board_pin_count` from Pinterest, stored in the new `pinCount` column and refreshed on every "Sync Live from Pinterest") |
| 3 | **NEW migration: `20260827120000_board_pin_count_privacy`** | Adds `PinterestBoard.pinCount` + `PinterestBoard.privacy`. Runs automatically on deploy — no manual action needed |
| 4 | **BUG: "Worker error: Custom Id cannot contain :"** | The worker's follow-up jobs (429 backoff retries) used `jobId: "pinId:timestamp"` — BullMQ forbids `:` in jobIds (Redis key separator), so every retry-able pin was dropped with this exact error. Separator is now `-`. Verified: BullMQ rejects the old id, accepts the new one |
| 5 | **BUG: only 1 worker running on Coolify** | Coolify runs a plain `docker compose up -d` and never passes `--scale`, so only 1 worker replica started. The compose file now defines **three explicit services** (`worker`, `worker-2`, `worker-3` — 150 parallel publishes at WORKER_CONCURRENCY=50). Purge job still runs on exactly one replica (Redis lock) |
| 6 | **BUG: refresh kicks you back to Overview** | Dashboard tabs now live in the URL hash (`#tab=boards`), admin tabs in `#admin=users`. Refresh / link-sharing / browser back/forward all keep you on the SAME section. Admin users who were visiting the user dashboard are no longer hijacked to the admin panel on reload |
| 7 | **FIX: HTML served with `Cache-Control: s-maxage=31536000`** | After a redeploy, browsers/CDNs could serve the OLD cached HTML referencing deleted JS chunks → blank page / dead buttons until a hard refresh. HTML documents now send `private, no-cache, must-revalidate`; hashed `/static/` assets stay immutable-cached |

**Deploy steps (same as before):** push to GitHub → Coolify redeploys with
`docker compose up -d --build`. The new migration applies automatically on
container boot (entrypoint runs `prisma migrate deploy`). After the deploy,
run `docker compose ps` — you should now see **6 services**: app, postgres,
redis, worker, worker-2, worker-3 (all healthy).

**Quick verification after deploy:**
1. `docker compose ps` → 3 worker replicas running (not 1)
2. Open the dashboard → new **Boards** item in the sidebar → select account → create a board
3. Navigate to any section (e.g. Scheduled) → press F5 → you stay on Scheduled (not Overview)
4. Worker logs (`docker compose logs worker | grep -i "custom id"`) → no more "Custom Id cannot contain :" errors

---

## What changed in the previous update (v3 — dashboard data fix + Pinterest theme)

| # | Fix | Why it matters |
|---|-----|----------------|
| 1 | **Seed always runs on startup** (entrypoint.sh) | ROOT CAUSE of "Overview / Plan & Payment showing old data": the seed was skipped whenever users existed, so updated plan prices/limits/features in `seed.ts` never reached the DB. Plans are now upserted on every boot |
| 2 | **Seed `update` blocks now include every field** | Pro/Agency `features`, `maxRowsPerImport` and `priceUsd` were missing from the upsert `update` blocks — they could never be changed after first deploy |
| 3 | **`apiFetch` sends `cache: 'no-store'`** | Browsers could HTTP-cache GET responses; dashboard numbers could go stale until a hard refresh |
| 4 | **Overview + Plan & Payment auto-refresh every 30s** | Usage counters / active schedules / quota now update live while the worker publishes pins in the background |
| 5 | **Plan features parsed safely (JSON.parse + fallback)** | "Current Plan" feature badges showed broken text like `["Single pin create"`; admin Plans tab could crash on legacy rows |
| 6 | **Pinterest red theme (#E60023) everywhere** | Homepage, dashboard, admin panel, auth forms, static pages (about/contact/terms/privacy): new `pin-*` color scale, red primary/ring/sidebar accents, red-family chart colors. Semantic status colors kept (green = published/verified, yellow = queued, red = failed) |

---

## What changed in the previous update (v2 — scale & storage)

| # | Fix | Why it matters |
|---|-----|----------------|
| 1 | **9 performance indexes** (new migration) | Without them every publish does a full-table COUNT; the DB dies within days at 500k pins/day |
| 2 | **Daily auto-purge job** (in the worker) | Keeps the 35GB disk from filling: final pins >14d, import batches/rows >7d, API logs >7d, audit logs >60d, expired OTPs |
| 3 | **Pinterest 429 backoff** | Rate-limited pins now back off (60s→2m→…→15m cap) instead of burning their 3 retries and failing |
| 4 | **Bulk CSV upload batching** | A 50k-row CSV used to be ~100,000 sequential DB writes (minutes, request timeouts). Now chunked `createMany` + `addBulk` — 10k rows ≈ 3 seconds |
| 5 | **Docker log rotation on every service** | The worker logs one line per published pin — without rotation that alone fills a 35GB disk in weeks |
| 6 | **Redis maxmemory + noeviction** | If Redis ever hits the cap, job writes fail loudly instead of silently evicting (losing) scheduled pins |
| 7 | **Token refresh race fix** | App-side board sync now takes the same per-connection lock the worker uses — no more random "reconnect your account" caused by refresh-token rotation races |
| 8 | **Import-batch status breakdown via groupBy** | History page no longer loads every pin row of every batch just to count statuses |
| 9 | **Disk monitor** | Worker `/health` reports disk usage + logs a warning at 80% |
| 10 | **package-lock.json resync** | `npm ci` (used by the Docker build) was broken — lockfile was out of sync with package.json |

All fixes were verified end-to-end against real PostgreSQL + Redis + the
production Docker build path: migrations applied, 10k-row CSV uploaded in
~3s, pins published through BullMQ, purge job verified (final pins removed,
queued pins untouched, quotas preserved).

---

## Local test (WSL Ubuntu + Docker)

```bash
cd pindesk
cp .env.example .env    # or use your existing .env
# fill in SESSION_SECRET, POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD at minimum

docker compose up -d --build

# apply DB migrations + seed happens automatically on app start;
# verify:
docker compose logs app | grep -i migrate
curl http://localhost:3000/api/health
```

Optional — scale the worker to 3 replicas (recommended for production):

```bash
docker compose up -d --scale worker=3
```

## Production deploy (Coolify)

1. Push this code to GitHub (`.env` is git-ignored — never pushed).
2. In Coolify, deploy from the repo using the included `docker-compose.yml`
   (Coolify reads it directly). Set the env vars from `.env.example` in the
   Coolify UI.
3. On first start the app container runs `prisma migrate deploy`
   (applies all migrations, including the new performance indexes) and
   seeds plans + the admin user.
4. Worker: runs as a single replica inside the 2 GB budget (see the
   v7 notes above for how to scale it back up on a bigger VPS).

### Recommended production sizing (2 GB stack budget)

| Setting | Value |
|---|---|
| `WORKER_CONCURRENCY` | `25` (single worker replica) |
| Worker replicas | `1` (=25 parallel publishes — ≈40k+ pins/hour capacity) |
| `REDIS_MAXMEMORY` | `384mb` (~300k+ pending jobs; raise on a bigger VPS) |
| `DB_POOL_SIZE` / `WORKER_DB_POOL` | `10` / `15` (Postgres `max_connections=60`) |
| Container limits | app 640M · worker 320M · postgres 384M · redis 576M = **1920M total** |
| VPS RAM | 8 GB (this stack hard-capped at ~1.9 GB; the rest stays for other apps) |
| VPS disk | 75 GB with default retention |

## Storage retention (keeps the disk bounded)

Configured via env (defaults shown):

```
PIN_RETENTION_DAYS=14        # published/canceled/failed pins kept 14 days
IMPORT_RETENTION_DAYS=7      # CSV import batches + rows kept 7 days
API_LOG_RETENTION_DAYS=7     # Pinterest API call log kept 7 days
AUDIT_LOG_RETENTION_DAYS=60  # admin audit trail kept 60 days
DISK_WARN_PERCENT=80         # worker warns when disk passes 80%
```

- CSV files are **never written to disk** — uploads are parsed in memory, so
  there is nothing to delete after publish; the purge job bounds the database.
- **Queued / paused / retrying pins are never purged** — only final statuses.
- Analytics history is bounded by pin retention (14 days by default). Raise
  `PIN_RETENTION_DAYS` if you need longer analytics (and more disk).
- One worker replica runs the purge per day (Redis lock decides which) —
  scaling workers never duplicates purges.

## Operations cheatsheet

```bash
# Worker health (queue depth, disk %, retention config)
curl http://localhost:3001/health

# Force a purge pass right now (ignores the once-per-day guard)
curl -X POST http://localhost:3001/purge

# Force a reconcile pass (re-enqueue any due pins missing from Redis)
curl -X POST http://localhost:3001/trigger

# Watch the queue in Redis
docker compose exec redis redis-cli LLEN bull:pin-publish:wait
docker compose exec redis redis-cli ZCARD bull:pin-publish:delayed

# Postgres size
docker compose exec postgres psql -U pindesk -d pindesk \
  -c "SELECT pg_size_pretty(pg_database_size('pindesk'));"
```

---

## Security & secret rotation (second-pass audit)

### Deploying this pass's changes (security review 2)

No new DB migrations — the only restart-sensitive change is the dependency
bump (Next.js 16.4.3) and new security headers:

```bash
docker compose build app worker   # dependency changes require a rebuild
docker compose up -d
curl -fsS https://your-domain/api/health
# Baseline headers present? (CSP ships in Report-Only first — check the
# browser console for violations for ~a week, then remove "-Report-Only"
# in next.config.ts to enforce)
curl -fsI https://your-domain/ | grep -Ei 'x-frame-options|strict-transport|x-content-type|content-security-policy'
```

### Secret rotation runbook

Rotate IMMEDIATELY if any secret may have leaked (committed .env, shared
zip, exposed logs). Otherwise rotate on the cadence given per secret.

| Secret | How to rotate | Impact of rotating |
|---|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` → `.env` → `docker compose up -d app worker` | **Signs out every user** and invalidates in-flight password-reset OTPs (they are HMAC'd with the same key). Do it in a low-traffic window. |
| `ADMIN_PASSWORD` | Change it **in the app's admin UI** (the seed only creates the admin when missing — it never overwrites). | None beyond re-login. |
| `POSTGRES_PASSWORD` | New password in `.env` → `docker compose up -d postgres` (compose rebuilds `DATABASE_URL` for app + worker) → restart both. | Brief DB connection drop. |
| `PINTEREST_APP_SECRET` | Rotate in the Pinterest dev portal → update `.env` → restart app + worker. | Existing connections keep working (their tokens are user-level); new connects + token refreshes use the new secret immediately. |
| `RESEND_API_KEY` | New key at resend.com → `.env` → restart app. | None — emails continue with the new key. |
| `TRONSCAN_API_KEY` | New key → `.env` → restart app. | Payment verification falls back to TronGrid if it were to fail; no stored state. |
| `WORKER_CONTROL_TOKEN` | `openssl rand -hex 24` → `.env` → restart worker. | Old token stops working on the next request. |

Never bake secrets into images (`.dockerignore` excludes `.env`) and never
commit `.env` — the repo's `.gitignore` covers it, but the **host's**
production `.env` must stay outside any git tree.

### Before the next app-tier scale-out

The rate limiter is in-memory by design for the single-instance budget
(`lib/rate-limit.ts`). If you ever run more than one `app` replica, switch
it to Redis-backed counters first — otherwise every replica counts limits
independently and the effective limit multiplies.

### Optional: partial unique index for payment TXIDs (needs one prod check first)

The auto-verification is replay-guarded by checks, but the DB has no unique
constraint on `PaymentOrder.txid`. Before adding it, run on **production**:

```sql
SELECT txid, count(*) FROM "PaymentOrder"
WHERE status='verified' AND txid IS NOT NULL
GROUP BY txid HAVING count(*) > 1;
```

If (and only if) this returns no rows, add the migration:

```sql
CREATE UNIQUE INDEX "PaymentOrder_txid_verified_unique"
  ON "PaymentOrder"(txid) WHERE status='verified';
```

If it returns rows, resolve the duplicates first (admin decision for each
order) — a blind migration would fail at boot.

---

## দ্রুত সারসংক্ষেপ (বাংলা)

- এই আপডেটে: ৯টা পারফরম্যান্স ইনডেক্স, ডেইলি অটো-পার্জ (১৪ দিন পিন / ৭ দিন ইমপোর্ট হিস্ট্রি), 429 ব্যাকঅফ, বাল্ক আপলোড ব্যাচিং (10k রো ≈ ৩ সেকেন্ড), ডকার লগ রোটেশন, Redis মেমোরি ক্যাপ, টোকেন রেফ্রেশ রেস ফিক্স।
- ডিপ্লয়: `docker compose up -d --build --scale worker=3` — `.env` ভ্যালু সেট করে দিলেই চলবে।
- ডিস্ক কখনো ফুল হবে না ডিফল্ট রিটেনশনে; বেশি অ্যানালিটিক্স হিস্ট্রি লাগলে `PIN_RETENTION_DAYS` বাড়ান।
