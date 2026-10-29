import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { enqueuePinJob } from '@/lib/queue'
import { getSubscriptionState, planExpiredResponseBody } from '@/lib/subscription'

// Pinterest v5 API hard limits for POST /v5/pins — a longer field is
// rejected with 400 "…too long (constraint: maxLength=…)" at publish time.
// Trim at creation so the stored pin is always publishable.
const PIN_LIMITS = { title: 100, description: 800, altText: 500 } as const

const trim = (v: string | null | undefined, max: number) =>
  v && v.length > max ? v.slice(0, max) : (v || null)

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Plan expired → no new pins until renewed (existing queued pins resume automatically on renewal)
  const subState = await getSubscriptionState(auth.user)
  if (subState.enforced && !subState.active) {
    return NextResponse.json(planExpiredResponseBody(subState), { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { connectionId, boardId, title, description, destinationUrl, imageUrl, altText, publishNow, scheduledFor: customScheduledFor } = body

  if (!connectionId || !boardId || typeof title !== 'string' || !title.trim() || !imageUrl || typeof imageUrl !== 'string') {
    return NextResponse.json({ error: 'connectionId, boardId, title, and imageUrl are required' }, { status: 400 })
  }

  // Verify ownership
  const conn = await db.pinterestConnection.findFirst({ where: { id: connectionId, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const board = await db.pinterestBoard.findFirst({ where: { id: boardId, connectionId } })
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

  // Check quota
  const plan = auth.user.currentPlanId
    ? await db.plan.findUnique({ where: { id: auth.user.currentPlanId } })
    : await db.plan.findUnique({ where: { id: 'plan_free' } })
  const monthKey = new Date().toISOString().slice(0, 7)
  let counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId: auth.session.userId, monthKey } } })
  if (!counter) {
    counter = await db.usageCounter.create({ data: { userId: auth.session.userId, monthKey } })
  }
  if (plan && counter.publishedCount >= plan.monthlyPinQuota) {
    return NextResponse.json({ error: 'Monthly pin quota exceeded' }, { status: 400 })
  }

  // Validate URL
  const isHttp = (v: string) => { try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false } }
  if (destinationUrl && (typeof destinationUrl !== 'string' || !isHttp(destinationUrl))) return NextResponse.json({ error: 'Invalid destination URL' }, { status: 400 })
  if (!isHttp(imageUrl)) return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 })

  const scheduledFor = publishNow
    ? new Date()
    : customScheduledFor
      ? new Date(customScheduledFor)
      : new Date(Date.now() + 60 * 1000)
  // An unparsable date used to reach Prisma as "Invalid Date" and surface as a 500
  if (isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledFor date' }, { status: 400 })
  }

  // Enforce Pinterest's field limits up front (title 100 / description 800 /
  // alt_text 500) — silently trimmed, same rule the bulk CSV import applies.
  const safeTitle = trim(title, PIN_LIMITS.title) || title.slice(0, PIN_LIMITS.title)
  const safeDescription = trim(description, PIN_LIMITS.description)
  const safeAltText = trim(altText, PIN_LIMITS.altText)

  const pin = await db.scheduledPin.create({
    data: {
      userId: auth.session.userId,
      connectionId,
      boardId,
      title: safeTitle,
      description: safeDescription,
      destinationUrl: destinationUrl || null,
      imageUrl,
      altText: safeAltText,
      scheduledFor,
      status: 'queued',
      payloadJson: JSON.stringify({ title: safeTitle, description: safeDescription, link: destinationUrl, board_id: board.pinterestBoardId, media_source: { source_type: 'image_url', url: imageUrl } }),
    },
    include: { board: { select: { boardName: true } } },
  })

  // The pin row already exists. If Redis is briefly down, failing the request here made users
  // retry and create DUPLICATE pins — the worker's reconciler enqueues any due 'queued' pin
  // within a minute anyway, so enqueue failure is not an error for the caller.
  try {
    await enqueuePinJob(pin.id, scheduledFor)
  } catch (err: any) {
    console.error('[pins/single] enqueue failed (reconciler will pick it up):', err?.message)
  }

  return NextResponse.json({ pin })
}
