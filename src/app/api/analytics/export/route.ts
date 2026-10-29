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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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

  // Real Pinterest organic daily metrics + the tool's own operational counts.
  const [pinterest, publishedPins, apiCallLogs] = await Promise.all([
    fetchPinterestAnalyticsForUser({ userId, start, end, connectionId }),
    db.scheduledPin.findMany({
      where: { userId, status: 'published', publishedAt: { gte: start, lte: endOfEnd }, ...connectionFilter },
      select: { publishedAt: true },
    }),
    db.apiCallLog.findMany({
      where: { userId, createdAt: { gte: start, lte: endOfEnd }, ...connectionFilter },
      select: { createdAt: true },
    }),
  ])

  type DayRow = {
    pinsPublished: number
    impressions: number
    pinClicks: number
    outboundClicks: number
    saves: number
    engagements: number
    apiCalls: number
  }
  const blank = (): DayRow => ({ pinsPublished: 0, impressions: 0, pinClicks: 0, outboundClicks: 0, saves: 0, engagements: 0, apiCalls: 0 })
  const byDay = new Map<string, DayRow>()

  const cur = new Date(start)
  while (cur.getTime() <= end.getTime()) {
    byDay.set(ymd(cur), blank())
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  for (const point of pinterest.daily) {
    const day = byDay.get(point.date) || blank()
    day.impressions += point.impressions
    day.pinClicks += point.pinClicks
    day.outboundClicks += point.outboundClicks
    day.saves += point.saves
    day.engagements += point.engagements
    byDay.set(point.date, day)
  }
  for (const pin of publishedPins) {
    if (!pin.publishedAt) continue
    const day = byDay.get(ymd(pin.publishedAt)) || blank()
    day.pinsPublished += 1
    byDay.set(ymd(pin.publishedAt), day)
  }
  for (const log of apiCallLogs) {
    const day = byDay.get(ymd(log.createdAt)) || blank()
    day.apiCalls += 1
    byDay.set(ymd(log.createdAt), day)
  }

  const header = ['Date', 'Pins Published', 'Impressions', 'Pin Clicks', 'Outbound Clicks', 'Saves', 'Engagements', 'Engagement Rate (%)', 'API Calls']
  const lines = [header.map(csvCell).join(',')]

  const totals = blank()
  const sortedDates = Array.from(byDay.keys()).sort()
  for (const date of sortedDates) {
    const d = byDay.get(date)!
    const rate = engagementRatePercent(d.engagements, d.impressions)
    lines.push([date, d.pinsPublished, d.impressions, d.pinClicks, d.outboundClicks, d.saves, d.engagements, rate, d.apiCalls].map(csvCell).join(','))
    totals.pinsPublished += d.pinsPublished
    totals.impressions += d.impressions
    totals.pinClicks += d.pinClicks
    totals.outboundClicks += d.outboundClicks
    totals.saves += d.saves
    totals.engagements += d.engagements
    totals.apiCalls += d.apiCalls
  }
  const totalRate = engagementRatePercent(totals.engagements, totals.impressions)
  lines.push(['Total', totals.pinsPublished, totals.impressions, totals.pinClicks, totals.outboundClicks, totals.saves, totals.engagements, totalRate, totals.apiCalls].map(csvCell).join(','))

  const csv = lines.join('\n')
  const filename = `pindesk-analytics-${ymd(start)}_to_${ymd(end)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
