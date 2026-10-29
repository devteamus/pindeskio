import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import {
  resolveDateRange,
  fetchPinterestAnalyticsForUser,
  engagementRatePercent,
  type AnalyticsRange,
} from '@/lib/pin-analytics'

const VALID_RANGES: AnalyticsRange[] = ['today', '7d', '15d', '30d', 'custom']

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const userId = auth.session.userId
  const { searchParams } = req.nextUrl
  const rangeParam = (searchParams.get('range') || '7d') as AnalyticsRange
  const range: AnalyticsRange = VALID_RANGES.includes(rangeParam) ? rangeParam : '7d'
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const connectionId = searchParams.get('connectionId') || undefined

  if (range === 'custom' && (!from || !to)) {
    return NextResponse.json({ error: 'Custom range requires from and to' }, { status: 400 })
  }

  const { start, end } = resolveDateRange(range, from, to)
  const endOfEnd = new Date(end)
  endOfEnd.setUTCHours(23, 59, 59, 999)
  const connectionFilter = connectionId ? { connectionId } : {}

  // REAL Pinterest organic analytics (user_account/analytics + top_pins)
  // fetched live with the account's OAuth token — plus the tool's own
  // operational counts (pins this tool published / API calls it made).
  const [pinterest, pinsPublished, apiCalls] = await Promise.all([
    fetchPinterestAnalyticsForUser({ userId, start, end, connectionId }),
    db.scheduledPin.count({
      where: { userId, status: 'published', publishedAt: { gte: start, lte: endOfEnd }, ...connectionFilter },
    }),
    db.apiCallLog.count({
      where: { userId, createdAt: { gte: start, lte: endOfEnd }, ...connectionFilter },
    }),
  ])

  return NextResponse.json({
    range: { key: range, start: start.toISOString(), end: end.toISOString() },
    metrics: {
      pinsPublished,
      impressions: pinterest.totals.impressions,
      pinClicks: pinterest.totals.pinClicks,
      outboundClicks: pinterest.totals.outboundClicks,
      saves: pinterest.totals.saves,
      engagements: pinterest.totals.engagements,
      engagementRate: engagementRatePercent(pinterest.totals.engagements, pinterest.totals.impressions),
      apiCalls,
    },
    topPins: pinterest.topPins,
    // Live-fetch metadata (UI uses these only for status notes)
    source: 'pinterest',
    hasRealConnection: pinterest.hasRealConnection,
    accountsIncluded: pinterest.accountsIncluded,
    errors: pinterest.errors,
    reauthNeeded: pinterest.reauthNeeded,
    dataThrough: pinterest.dataThrough,
  })
}
