import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { parsePagination } from '@/lib/pagination'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { connectionId, status } = Object.fromEntries(req.nextUrl.searchParams)
  const { page, limit, skip } = parsePagination(req.nextUrl.searchParams)

  const where: any = { userId: auth.session.userId }
  if (connectionId) where.connectionId = connectionId
  if (status) where.status = status
  if (!status) where.status = { in: ['published', 'failed_final', 'retry_waiting', 'canceled'] }

  const [logs, total] = await Promise.all([
    db.scheduledPin.findMany({
      where,
      include: { board: { select: { boardName: true } } },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    db.scheduledPin.count({ where }),
  ])

  return NextResponse.json({ logs, total, page, limit })
}
