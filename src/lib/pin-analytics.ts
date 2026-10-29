// ─── Pinterest Organic Analytics (v5) ───────────────────────────────
// Fetches REAL organic analytics from the official Pinterest API v5
// endpoints, using the connected account's OAuth access token:
//
//   GET /v5/user_account/analytics            → account-level metrics
//        (IMPRESSION, PIN_CLICK, OUTBOUND_CLICK, SAVE, ENGAGEMENT, ENGAGEMENT_RATE)
//   GET /v5/user_account/analytics/top_pins   → Top Pins section
//   GET /v5/pins/{pin_id}/analytics           → individual pin analytics
//
// All numbers shown on the Analytics Dashboard come directly from these
// API responses. There is NO mock/simulated data and NO deriving of
// Pinterest metrics from the local database — the only local counts are
// the tool's own operational stats ("Pins Published" = pins this tool
// published, "API Calls" = calls this tool made).
//
// Pinterest quirks handled here:
//   - Organic analytics data is DELAYED (up to ~2 days) and is never
//     available for "today" → end_date is capped at yesterday (UTC).
//   - The analytics window is capped at 90 days per request.
//   - A fresh token is obtained per connection (refreshed under the same
//     Redis lock the worker uses, so the app can never race a worker
//     replica into invalidating the rotating refresh token).
//   - 429/5xx/401 from one account never breaks the whole dashboard —
//     the other accounts still report, and errors are surfaced per account.

import { db } from './db'
import { config } from './config'
import { refreshAccessToken } from './pinterest'
import { withConnectionLock } from './queue'

export type AnalyticsRange = 'today' | '7d' | '15d' | '30d' | 'custom'

export interface ResolvedRange {
  start: Date // inclusive, UTC midnight
  end: Date   // inclusive, UTC midnight (end of range, i.e. "today")
}

/**
 * Turn a range key (+ optional custom from/to) into concrete UTC day
 * boundaries. `end` is always today unless a custom range is given.
 */
export function resolveDateRange(range: AnalyticsRange, from?: string | null, to?: string | null): ResolvedRange {
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)

  if (range === 'custom' && from && to) {
    const start = new Date(from)
    const end = new Date(to)
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCHours(0, 0, 0, 0)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return { start: todayUtc, end: todayUtc }
    if (start.getTime() > end.getTime()) return { start: end, end: start }
    return { start, end }
  }

  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === '15d' ? 14 : 29 // 30d default
  const start = new Date(todayUtc)
  start.setUTCDate(start.getUTCDate() - days)
  return { start, end: todayUtc }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── API Call Logging ──────────────────────────────────────────────
// Fire-and-forget — never throws, never blocks the caller.
export function recordApiCall(userId: string, endpoint: string, connectionId?: string): void {
  db.apiCallLog.create({ data: { userId, endpoint, connectionId } }).catch((err) => {
    console.error('[pin-analytics] Failed to record API call:', (err as Error).message)
  })
}

// ─── Metric types requested from Pinterest ─────────────────────────
// Full Standard-access organic metric set. If a token/account rejects the
// newer ENGAGEMENT/ENGAGEMENT_RATE types (400), callers retry with the
// classic 4 metrics and ENGAGEMENT is summed from the returned values.
export const FULL_METRIC_TYPES = 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE,ENGAGEMENT,ENGAGEMENT_RATE'
export const BASIC_METRIC_TYPES = 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE'

export interface DailyPoint {
  date: string // YYYY-MM-DD
  impressions: number
  pinClicks: number
  outboundClicks: number
  saves: number
  engagements: number
}

export interface AccountTotals {
  impressions: number
  pinClicks: number
  outboundClicks: number
  saves: number
  engagements: number
}

function emptyTotals(): AccountTotals {
  return { impressions: 0, pinClicks: 0, outboundClicks: 0, saves: 0, engagements: 0 }
}

// ─── Response parsing (defensive) ──────────────────────────────────
// Pinterest has shipped more than one response layout for these endpoints
// across API versions (metrics flat on each daily entry vs nested under a
// `metrics` object; daily_metrics at the top level vs under `all`). Parse
// every variant so a layout change never zeroes the dashboard out.

type RawRecord = Record<string, unknown>

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function metric(entry: RawRecord, key: string): number {
  const nested = (entry.metrics as RawRecord | undefined)?.[key]
  if (typeof nested === 'number') return nested
  const flat = entry[key]
  if (typeof flat === 'number') return flat
  return 0
}

function hasMetric(entry: RawRecord, key: string): boolean {
  const nested = (entry.metrics as RawRecord | undefined)?.[key]
  if (typeof nested === 'number') return true
  return typeof entry[key] === 'number'
}

function parseDailyEntries(data: RawRecord): RawRecord[] {
  const top = data.daily_metrics
  if (Array.isArray(top)) return top as RawRecord[]
  const all = (data.all as RawRecord | undefined)?.daily_metrics
  if (Array.isArray(all)) return all as RawRecord[]
  return []
}

function toDailyPoint(entry: RawRecord): DailyPoint | null {
  const date = typeof entry.date === 'string' ? entry.date : null
  if (!date) return null
  const impressions = metric(entry, 'IMPRESSION')
  const pinClicks = metric(entry, 'PIN_CLICK')
  const outboundClicks = metric(entry, 'OUTBOUND_CLICK')
  const saves = metric(entry, 'SAVE')
  // Prefer Pinterest's own ENGAGEMENT metric; only when the account/token
  // doesn't support it do we sum the (real) component metrics.
  const engagements = hasMetric(entry, 'ENGAGEMENT')
    ? metric(entry, 'ENGAGEMENT')
    : pinClicks + outboundClicks + saves
  return { date, impressions, pinClicks, outboundClicks, saves, engagements }
}

function sumDaily(daily: DailyPoint[]): AccountTotals {
  const totals = emptyTotals()
  for (const d of daily) {
    totals.impressions += d.impressions
    totals.pinClicks += d.pinClicks
    totals.outboundClicks += d.outboundClicks
    totals.saves += d.saves
    totals.engagements += d.engagements
  }
  return totals
}

// ─── Date-window caps for organic analytics ────────────────────────
// Today's organic data is never ready (delayed up to ~2 days), and the
// window per request is capped at 90 days.
function capWindow(start: Date, end: Date): { startDate: string; endDate: string } {
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)
  const yesterday = new Date(todayUtc)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)

  let e = end.getTime() > yesterday.getTime() ? new Date(yesterday) : new Date(end)
  let s = new Date(start)
  if (s.getTime() > e.getTime()) s = new Date(e) // whole range in the future → collapse
  const maxStart = new Date(e)
  maxStart.setUTCDate(maxStart.getUTCDate() - 89) // 90-day cap
  if (s.getTime() < maxStart.getTime()) s = maxStart
  return { startDate: ymd(s), endDate: ymd(e) }
}

// ─── Low-level fetch with error classification ─────────────────────

export class PinterestApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function pinterestGet(url: string, accessToken: string): Promise<RawRecord> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new PinterestApiError(res.status, `Pinterest ${res.status}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as RawRecord
}

// ─── GET /v5/user_account/analytics ────────────────────────────────

/**
 * Real account-level organic metrics for the authenticated user, per day,
 * for [start, end] (capped to Pinterest's availability window).
 */
export async function fetchUserAccountAnalytics(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<{ daily: DailyPoint[]; totals: AccountTotals }> {
  const { startDate, endDate } = capWindow(start, end)

  const buildUrl = (metricTypes: string) => {
    const url = new URL(`${config.pinterestApiBase}/user_account/analytics`)
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    url.searchParams.set('metric_types', metricTypes)
    return url.toString()
  }

  let data: RawRecord
  try {
    data = await pinterestGet(buildUrl(FULL_METRIC_TYPES), accessToken)
  } catch (err) {
    // Some tokens reject the newer ENGAGEMENT/ENGAGEMENT_RATE metric types —
    // retry once with the classic four metrics.
    if (err instanceof PinterestApiError && err.status === 400) {
      data = await pinterestGet(buildUrl(BASIC_METRIC_TYPES), accessToken)
    } else {
      throw err
    }
  }

  const daily: DailyPoint[] = []
  for (const entry of parseDailyEntries(data)) {
    const point = toDailyPoint(entry)
    if (point) daily.push(point)
  }
  return { daily, totals: sumDaily(daily) }
}

// ─── GET /v5/user_account/analytics/top_pins ───────────────────────

export interface TopPinResult {
  id: string                 // Pinterest pin id
  title: string
  imageUrl: string | null
  url: string
  impressions: number
  engagements: number
  saves: number
  pinClicks: number
  outboundClicks: number
}

function pickLargestImage(pin: RawRecord): string | null {
  const images = (pin.media as RawRecord | undefined)?.images as Record<string, { url?: string; width?: number; height?: number }> | undefined
  if (!images) return null
  let best: { url?: string; area: number } | null = null
  for (const [key, img] of Object.entries(images)) {
    if (!img?.url) continue
    const m = /^(\d+)x(\d+)$/.exec(key)
    const area = m ? Number(m[1]) * Number(m[2]) : (img.width || 0) * (img.height || 0)
    if (!best || area > best.area) best = { url: img.url, area }
  }
  return best?.url || null
}

function mapTopPinItem(item: RawRecord): TopPinResult | null {
  const pin = item.pin as RawRecord | undefined
  if (!pin || typeof pin.id !== 'string') return null
  const impressions = metric(item, 'IMPRESSION')
  const pinClicks = metric(item, 'PIN_CLICK')
  const outboundClicks = metric(item, 'OUTBOUND_CLICK')
  const saves = metric(item, 'SAVE')
  const engagements = hasMetric(item, 'ENGAGEMENT')
    ? metric(item, 'ENGAGEMENT')
    : pinClicks + outboundClicks + saves
  const board = pin.board as RawRecord | undefined
  const title =
    (typeof pin.title === 'string' && pin.title.trim()) ||
    (typeof pin.description === 'string' && pin.description.trim()) ||
    (typeof pin.grid_title === 'string' && pin.grid_title.trim()) ||
    (typeof board?.name === 'string' && board.name.trim()) ||
    'Pinterest Pin'
  return {
    id: pin.id,
    title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
    imageUrl: pickLargestImage(pin),
    url: `https://www.pinterest.com/pin/${pin.id}/`,
    impressions,
    engagements,
    saves,
    pinClicks,
    outboundClicks,
  }
}

/**
 * The account's top pins for [start, end], ranked by Pinterest (sorted by
 * ENGAGEMENT; falls back to IMPRESSION if the account rejects that sort key).
 */
export async function fetchTopPins(
  accessToken: string,
  start: Date,
  end: Date,
  pageSize = 5,
): Promise<TopPinResult[]> {
  const { startDate, endDate } = capWindow(start, end)

  const buildUrl = (sortBy: string) => {
    const url = new URL(`${config.pinterestApiBase}/user_account/analytics/top_pins`)
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    url.searchParams.set('sort_by', sortBy)
    url.searchParams.set('metric_types', FULL_METRIC_TYPES)
    url.searchParams.set('page_size', String(pageSize))
    return url.toString()
  }

  let data: RawRecord
  try {
    data = await pinterestGet(buildUrl('ENGAGEMENT'), accessToken)
  } catch (err) {
    if (err instanceof PinterestApiError && err.status === 400) {
      // Older metric set on this token — sort by impressions instead.
      const url = new URL(`${config.pinterestApiBase}/user_account/analytics/top_pins`)
      url.searchParams.set('start_date', startDate)
      url.searchParams.set('end_date', endDate)
      url.searchParams.set('sort_by', 'IMPRESSION')
      url.searchParams.set('metric_types', BASIC_METRIC_TYPES)
      url.searchParams.set('page_size', String(pageSize))
      data = await pinterestGet(url.toString(), accessToken)
    } else {
      throw err
    }
  }

  const items = data.items
  if (!Array.isArray(items)) return []
  const pins: TopPinResult[] = []
  for (const item of items as RawRecord[]) {
    const mapped = mapTopPinItem(item)
    if (mapped) pins.push(mapped)
  }
  return pins
}

// ─── GET /v5/pins/{pin_id}/analytics ───────────────────────────────

/**
 * Real per-pin organic analytics for one Pinterest pin, for [start, end].
 * Used whenever individual pin-level analytics are required (e.g. a pin
 * detail view). `summary` holds Pinterest's summary_metrics when present.
 */
export async function fetchPinAnalytics(
  accessToken: string,
  pinId: string,
  start: Date,
  end: Date,
): Promise<{ daily: DailyPoint[]; totals: AccountTotals }> {
  const { startDate, endDate } = capWindow(start, end)

  const buildUrl = (metricTypes: string) => {
    const url = new URL(`${config.pinterestApiBase}/pins/${encodeURIComponent(pinId)}/analytics`)
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    url.searchParams.set('metric_types', metricTypes)
    return url.toString()
  }

  let data: RawRecord
  try {
    data = await pinterestGet(buildUrl(FULL_METRIC_TYPES), accessToken)
  } catch (err) {
    if (err instanceof PinterestApiError && err.status === 400) {
      data = await pinterestGet(buildUrl(BASIC_METRIC_TYPES), accessToken)
    } else {
      throw err
    }
  }

  const daily: DailyPoint[] = []
  for (const entry of parseDailyEntries(data)) {
    const point = toDailyPoint(entry)
    if (point) daily.push(point)
  }
  // If Pinterest gave a summary_metrics object, prefer it for the totals —
  // it covers days whose data was DELAYED at daily granularity too.
  const summary = data.summary_metrics as RawRecord | undefined
  let totals = sumDaily(daily)
  if (summary && (typeof summary.IMPRESSION === 'number' || typeof (summary.metrics as RawRecord | undefined)?.IMPRESSION === 'number')) {
    totals = {
      impressions: metric(summary, 'IMPRESSION'),
      pinClicks: metric(summary, 'PIN_CLICK'),
      outboundClicks: metric(summary, 'OUTBOUND_CLICK'),
      saves: metric(summary, 'SAVE'),
      engagements: hasMetric(summary, 'ENGAGEMENT')
        ? metric(summary, 'ENGAGEMENT')
        : metric(summary, 'PIN_CLICK') + metric(summary, 'OUTBOUND_CLICK') + metric(summary, 'SAVE'),
    }
  }
  return { daily, totals }
}

// ─── Valid access token for a connection (refresh under lock) ──────
// Same protocol as the boards sync route: re-read the connection inside
// the SAME per-connection Redis lock the worker uses, so the app and a
// worker replica can never both refresh Pinterest's rotating refresh token.

type TokenOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; reauth?: boolean; busy?: boolean }

async function refreshTokensFor(connectionId: string): Promise<TokenOutcome> {
  const fresh = await db.pinterestConnection.findUnique({ where: { id: connectionId } })
  if (!fresh) return { ok: false, error: 'Connection not found' }
  if (!fresh.refreshToken) return { ok: false, error: 'Missing refresh token', reauth: true }
  try {
    const tokenData = await refreshAccessToken(fresh.refreshToken)
    await db.pinterestConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || fresh.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        refreshTokenExpiresAt: tokenData.refresh_token_expires_in
          ? new Date(Date.now() + tokenData.refresh_token_expires_in * 1000)
          : fresh.refreshTokenExpiresAt,
      },
    })
    return { ok: true, accessToken: tokenData.access_token }
  } catch (err) {
    const message = (err as Error).message || ''
    // invalid_grant / 401 = the refresh token itself is dead → reconnect needed.
    if (message.includes('invalid_grant') || message.includes('refresh_token') || message.includes('(401)')) {
      return { ok: false, error: 'Token expired — reconnect this Pinterest account', reauth: true }
    }
    return { ok: false, error: `Token refresh failed: ${message.slice(0, 200)}` }
  }
}

export async function getConnectionAccessToken(connectionId: string): Promise<TokenOutcome> {
  const conn = await db.pinterestConnection.findUnique({ where: { id: connectionId } })
  if (!conn) return { ok: false, error: 'Connection not found' }
  if (!conn.accessToken || conn.accessToken.startsWith('simulated_') || !conn.refreshToken) {
    return { ok: false, error: 'Not a real Pinterest connection', reauth: true }
  }

  const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null
  const stillValid = expiresAt !== null && Date.now() < expiresAt.getTime() - 5 * 60 * 1000
  if (stillValid) return { ok: true, accessToken: conn.accessToken }

  const locked = await withConnectionLock(connectionId, () => refreshTokensFor(connectionId))
  if (locked.ok) return locked.value
  if (locked.reason === 'busy') {
    return { ok: false, error: 'Account is busy publishing right now — try again in a few seconds', busy: true }
  }
  // Redis unreachable → no worker can be mid-publish either; direct refresh is safe.
  return refreshTokensFor(connectionId)
}

// ─── Small in-memory cache ──────────────────────────────────────────
// Pinterest organic data is itself delayed ~2 days, so a short per-process
// cache keeps tab switches / quick reloads from hammering the API (rate
// limits) without any visible staleness. Only successful responses cache.
const CACHE_TTL_MS = 3 * 60 * 1000
// Bounded cache: without a cap this Map grew forever (one key per
// connection × date-range, and the keys change as date ranges shift each
// day). At thousands of connected accounts that is a slow, unbounded
// memory leak in the app process. 200 entries × ~25KB ≈ 5MB worst case —
// far more than 100 concurrent users can keep warm, and eviction is
// invisible to users (a cold fetch costs one rate-limited API call).
const CACHE_MAX_ENTRIES = 200

interface CachedAccount {
  daily: DailyPoint[]
  totals: AccountTotals
  topPins: TopPinResult[]
  cachedAt: number
}

const accountCache = new Map<string, CachedAccount>()

function cacheKey(connectionId: string, start: Date, end: Date): string {
  return `${connectionId}:${ymd(start)}:${ymd(end)}`
}

/** Insert with LRU-style eviction: drop expired entries first, then oldest-inserted. */
function cacheSet(key: string, value: CachedAccount) {
  if (accountCache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now()
    // First pass: free everything already expired (cheap wins).
    for (const [k, v] of accountCache) {
      if (now - v.cachedAt >= CACHE_TTL_MS) accountCache.delete(k)
    }
    // Still at/over the cap: evict oldest-inserted entries (Map preserves
    // insertion order, so the first keys are the least recently written).
    while (accountCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = accountCache.keys().next().value
      if (oldest === undefined) break
      accountCache.delete(oldest)
    }
  }
  // Re-inserting an existing key refreshes its insertion-order position.
  accountCache.delete(key)
  accountCache.set(key, value)
}

// ─── Per-account fetch (analytics + top pins, cached) ──────────────

async function fetchAccountAnalytics(
  connectionId: string,
  userId: string,
  start: Date,
  end: Date,
): Promise<CachedAccount> {
  const key = cacheKey(connectionId, start, end)
  const cached = accountCache.get(key)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached
  if (cached) accountCache.delete(key) // expired — free it now instead of leaving it for the size cap

  const token = await getConnectionAccessToken(connectionId)
  if (!token.ok) throw new PinterestApiError(token.reauth ? 401 : 503, token.error)

  const [account, topPins] = await Promise.all([
    fetchUserAccountAnalytics(token.accessToken, start, end),
    fetchTopPins(token.accessToken, start, end, 5).catch((err) => {
      // Top pins failing must not zero out the metric cards.
      console.error('[pin-analytics] top_pins failed for connection', connectionId, (err as Error).message)
      return [] as TopPinResult[]
    }),
  ])
  recordApiCall(userId, 'user_account/analytics', connectionId)
  recordApiCall(userId, 'user_account/analytics/top_pins', connectionId)

  const result: CachedAccount = {
    daily: account.daily,
    totals: account.totals,
    topPins,
    cachedAt: Date.now(),
  }
  cacheSet(key, result)
  return result
}

// ─── Multi-account orchestrator ────────────────────────────────────

export interface PinterestAnalyticsResult {
  hasRealConnection: boolean
  accountsIncluded: number
  totals: AccountTotals
  daily: DailyPoint[]              // merged across accounts (real API days only)
  topPins: TopPinResult[]          // top 5 across accounts, by engagement
  errors: string[]                 // per-account fetch errors (human-readable)
  reauthNeeded: string[]           // account names that must be reconnected
  dataThrough: string | null       // latest YYYY-MM-DD with any data
}

/** Bounded-concurrency map — keeps Pinterest rate limits happy. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Fetch REAL organic analytics for every connected Pinterest account of a
 * user (or one specific connection) and merge them:
 *   - account-level metrics are summed across accounts
 *   - top pins are merged and re-ranked by engagement (top 5)
 *   - one failing account never fails the request — its error is returned
 *
 * Simulated/demo connections (no real OAuth token) contribute nothing:
 * they have no Pinterest analytics, and NO mock data is invented for them.
 */
export async function fetchPinterestAnalyticsForUser(opts: {
  userId: string
  start: Date
  end: Date
  connectionId?: string
}): Promise<PinterestAnalyticsResult> {
  const connections = await db.pinterestConnection.findMany({
    where: {
      userId: opts.userId,
      ...(opts.connectionId ? { id: opts.connectionId } : {}),
    },
    select: { id: true, nickname: true, profileName: true, status: true, accessToken: true },
    orderBy: { createdAt: 'asc' },
  })

  const nameOf = (c: { nickname: string | null; profileName: string | null; id: string }) =>
    c.nickname || c.profileName || c.id.slice(0, 8)

  const real = connections.filter(
    (c) => c.accessToken && !c.accessToken.startsWith('simulated_') && c.status !== 'disconnected',
  )

  const result: PinterestAnalyticsResult = {
    hasRealConnection: real.length > 0,
    accountsIncluded: 0,
    totals: emptyTotals(),
    daily: [],
    topPins: [],
    errors: [],
    reauthNeeded: connections
      .filter((c) => c.status === 'reauth_required')
      .map((c) => nameOf(c)),
    dataThrough: null,
  }

  if (real.length === 0) return result

  await mapPool(real, 5, async (conn) => {
    try {
      const account = await fetchAccountAnalytics(conn.id, opts.userId, opts.start, opts.end)
      result.accountsIncluded += 1
      result.totals.impressions += account.totals.impressions
      result.totals.pinClicks += account.totals.pinClicks
      result.totals.outboundClicks += account.totals.outboundClicks
      result.totals.saves += account.totals.saves
      result.totals.engagements += account.totals.engagements
      result.daily.push(...account.daily)
      result.topPins.push(...account.topPins)
    } catch (err) {
      const message = (err as Error).message || 'Unknown error'
      if (/reconnect/i.test(message) || /Token expired/i.test(message)) {
        result.reauthNeeded.push(nameOf(conn))
        await db.pinterestConnection.update({
          where: { id: conn.id },
          data: { status: 'reauth_required' },
        }).catch(() => {})
      } else {
        result.errors.push(`${nameOf(conn)}: ${message.slice(0, 160)}`)
      }
    }
  })

  // Merge daily points across accounts
  const byDate = new Map<string, DailyPoint>()
  for (const point of result.daily) {
    const existing = byDate.get(point.date)
    if (!existing) {
      byDate.set(point.date, { ...point })
    } else {
      existing.impressions += point.impressions
      existing.pinClicks += point.pinClicks
      existing.outboundClicks += point.outboundClicks
      existing.saves += point.saves
      existing.engagements += point.engagements
    }
  }
  result.daily = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  result.dataThrough = result.daily.length > 0 ? result.daily[result.daily.length - 1].date : null

  // Top 5 pins across all accounts, ranked by real engagement numbers
  result.topPins.sort((a, b) => b.engagements - a.engagements)
  result.topPins = result.topPins.slice(0, 5)

  return result
}

// ─── Engagement rate ───────────────────────────────────────────────
// Pinterest's ENGAGEMENT_RATE is engagements ÷ impressions (a fraction).
// Deriving it from the two real API numbers is unit-safe and identical.
export function engagementRatePercent(engagements: number, impressions: number): number {
  if (impressions <= 0) return 0
  return Math.round((engagements / impressions) * 10000) / 100
}
