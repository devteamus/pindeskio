import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { createPinterestBoard, refreshAccessToken } from '@/lib/pinterest'
import { withConnectionLock } from '@/lib/queue'
import { recordApiCall } from '@/lib/pin-analytics'

/**
 * POST /api/boards/create
 * Body: { connectionId, name, description?, privacy?: 'PUBLIC' | 'SECRET' }
 *
 * Creates a board on the SELECTED Pinterest account (the user picks the
 * account from a dropdown in the dashboard Boards tab), then saves it to
 * our DB so it is instantly available for pin scheduling.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const { connectionId, name, description, privacy } = body as {
    connectionId?: string
    name?: string
    description?: string
    privacy?: 'PUBLIC' | 'SECRET'
  }

  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 })

  const trimmedName = (name || '').trim()
  if (!trimmedName) return NextResponse.json({ error: 'Board name is required' }, { status: 400 })
  if (trimmedName.length > 180) return NextResponse.json({ error: 'Board name must be 180 characters or fewer' }, { status: 400 })
  if (description && description.length > 500) return NextResponse.json({ error: 'Board description must be 500 characters or fewer' }, { status: 400 })
  const boardPrivacy = privacy === 'SECRET' ? 'SECRET' : 'PUBLIC'

  const conn = await db.pinterestConnection.findFirst({ where: { id: connectionId, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  if (conn.status !== 'active' && conn.status !== 'rate_limited') {
    return NextResponse.json({ error: 'This account is not active. Please reconnect it first.' }, { status: 400 })
  }

  // Prevent obvious duplicates within the same account (cheap UX guard —
  // Pinterest itself allows duplicate names, so only warn on exact matches).
  const duplicate = await db.pinterestBoard.findFirst({
    where: { connectionId, boardName: trimmedName, isActive: true },
  })
  if (duplicate) {
    return NextResponse.json({ error: `A board named "${trimmedName}" already exists on this account.` }, { status: 409 })
  }

  // === Simulated connection (demo mode — OAuth not configured) ===
  if (!conn.accessToken || conn.accessToken.startsWith('simulated_') || !conn.refreshToken) {
    const created = await db.pinterestBoard.create({
      data: {
        connectionId,
        pinterestBoardId: 'board_' + Math.random().toString(36).substring(2, 12),
        boardName: trimmedName,
        boardDescription: description?.trim() || null,
        privacy: boardPrivacy,
        pinCount: 0,
        isActive: true,
        syncedAt: new Date(),
      },
    })
    await db.pinterestConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: new Date() } })
    return NextResponse.json({ board: created, simulated: true })
  }

  // === Real API board creation ===
  try {
    let accessToken = conn.accessToken
    const now = new Date()
    const tokenExpiry = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null

    // Refresh if expired (within 5 min buffer) — under the SAME per-connection
    // Redis lock the worker uses, so app + worker replicas can never refresh
    // simultaneously with Pinterest's rotating refresh tokens.
    if (!tokenExpiry || now >= new Date(tokenExpiry.getTime() - 5 * 60 * 1000)) {
      const refreshViaLock = async (): Promise<string> => {
        // Re-read inside the lock — the worker may have JUST refreshed it.
        const fresh = await db.pinterestConnection.findUnique({ where: { id: connectionId } })
        if (fresh?.accessToken && !fresh.accessToken.startsWith('simulated_') && fresh.tokenExpiresAt) {
          if (new Date(fresh.tokenExpiresAt).getTime() > Date.now() + 5 * 60 * 1000) {
            return fresh.accessToken // already refreshed by the worker — free win
          }
        }
        const tokenData = await refreshAccessToken(fresh?.refreshToken || conn.refreshToken || '')
        await db.pinterestConnection.update({
          where: { id: connectionId },
          data: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || fresh?.refreshToken || conn.refreshToken,
            tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
            refreshTokenExpiresAt: tokenData.refresh_token_expires_in
              ? new Date(Date.now() + tokenData.refresh_token_expires_in * 1000)
              : fresh?.refreshTokenExpiresAt || conn.refreshTokenExpiresAt,
          },
        })
        return tokenData.access_token
      }

      const locked = await withConnectionLock(connectionId, refreshViaLock)
      if (locked.ok) {
        accessToken = locked.value
      } else if (locked.reason === 'busy') {
        return NextResponse.json({ error: 'This account is currently publishing pins. Please try creating the board again in a few seconds.' }, { status: 503 })
      } else {
        // Redis unreachable — no worker can be mid-publish either, safe direct refresh
        const tokenData = await refreshAccessToken(conn.refreshToken)
        accessToken = tokenData.access_token
        await db.pinterestConnection.update({
          where: { id: connectionId },
          data: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || conn.refreshToken,
            tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
            refreshTokenExpiresAt: tokenData.refresh_token_expires_in
              ? new Date(Date.now() + tokenData.refresh_token_expires_in * 1000)
              : conn.refreshTokenExpiresAt,
          },
        })
      }
    }

    const remoteBoard = await createPinterestBoard(accessToken, {
      name: trimmedName,
      description: description?.trim() || undefined,
      privacy: boardPrivacy,
    })
    recordApiCall(auth.session.userId, 'boards', connectionId)

    const created = await db.pinterestBoard.create({
      data: {
        connectionId,
        pinterestBoardId: remoteBoard.id,
        boardName: remoteBoard.name || trimmedName,
        boardDescription: remoteBoard.description || description?.trim() || null,
        privacy: remoteBoard.privacy || boardPrivacy,
        pinCount: remoteBoard.board_pin_count ?? 0,
        isActive: true,
        syncedAt: new Date(),
      },
    })

    return NextResponse.json({ board: created })
  } catch (err: any) {
    if (err.message?.includes('invalid_grant') || err.message?.includes('refresh_token')) {
      await db.pinterestConnection.update({ where: { id: connectionId }, data: { status: 'reauth_required' } })
      return NextResponse.json({ error: 'Token expired. Please reconnect your Pinterest account.', needsReauth: true }, { status: 401 })
    }
    // Pinterest rate limit (429) — surface a friendly message
    if (err.message?.includes('(429)')) {
      return NextResponse.json({ error: 'Pinterest is rate-limiting this account. Please wait a minute and try again.' }, { status: 429 })
    }
    // SECURITY: Log full error server-side, return generic message to client
    console.error('[boards/create] Failed:', err.message)
    return NextResponse.json({ error: 'Board creation failed. Please try again or reconnect your Pinterest account.' }, { status: 500 })
  }
}
