import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const conn = await db.pinterestConnection.findFirst({ where: { id, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  // paused / retry_waiting too: they used to survive the disconnect and could later be resumed
  // against an account that no longer has tokens.
  await db.scheduledPin.updateMany({ where: { connectionId: id, status: { in: ['queued', 'draft', 'paused', 'retry_waiting'] } }, data: { status: 'canceled', lastError: 'Pinterest account was disconnected' } })

  // SOFT DELETE — do NOT hard-delete the row. Hard-deleting used to wipe
  // out this account's publish history, which meant:
  //   1) The worker's per-account 24h publish count (getPublishedCountLast24h,
  //      keyed by connectionId) would silently reset on disconnect+reconnect,
  //      letting a real Pinterest account exceed the plan's daily limit.
  //   2) A user could disconnect + reconnect brand-new accounts forever to
  //      dodge the plan's max-connected-accounts cap (see the lifetime check
  //      added in /api/connections POST and /api/pinterest/callback).
  // Keeping the row (with tokens cleared) lets a later reconnect of the SAME
  // Pinterest account reuse this exact row — preserving history — while a
  // disconnected account is filtered out of the active list and no longer
  // counts against the concurrent-connections limit.
  await db.pinterestBoard.updateMany({ where: { connectionId: id }, data: { isActive: false } })
  await db.pinterestConnection.update({
    where: { id },
    data: {
      status: 'disconnected',
      disconnectedAt: new Date(),
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    },
  })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const { nickname } = await req.json()
  const conn = await db.pinterestConnection.findFirst({ where: { id, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  // SECURITY (2nd-pass audit): the GET route was hardened to never expose
  // accessToken/refreshToken, but this update returned EVERY column — leaking
  // live OAuth tokens in the response body. Select the same safe fields.
  const updated = await db.pinterestConnection.update({
    where: { id },
    data: { nickname },
    select: {
      id: true,
      userId: true,
      pinterestAccountId: true,
      profileName: true,
      profileImageUrl: true,
      status: true,
      lastSyncedAt: true,
      nickname: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ connection: updated })
}
