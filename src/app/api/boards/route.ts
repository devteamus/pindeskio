import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { fetchPinterestBoards, refreshAccessToken, boardPinCount, PinterestBoardApi } from '@/lib/pinterest'
import { withConnectionLock } from '@/lib/queue'
import { recordApiCall, getConnectionAccessToken } from '@/lib/pin-analytics'

// ─── Shared helpers ─────────────────────────────────────────────────

function summarizeBoards(boards: { pinCount: number }[]) {
  return {
    totalBoards: boards.length,
    boardsWithPins: boards.filter((b) => b.pinCount > 0).length,
    totalPins: boards.reduce((sum, b) => sum + b.pinCount, 0),
  }
}

/** Upsert live Pinterest boards into the local cache (deactivates removed ones). */
async function persistRemoteBoards(connectionId: string, remoteBoards: PinterestBoardApi[]) {
  const remoteBoardIds = new Set(remoteBoards.map((b) => b.id))
  if (remoteBoardIds.size > 0) {
    await db.pinterestBoard.updateMany({
      where: { connectionId, pinterestBoardId: { notIn: Array.from(remoteBoardIds) } },
      data: { isActive: false },
    })
  }
  for (const board of remoteBoards) {
    const existing = await db.pinterestBoard.findFirst({ where: { connectionId, pinterestBoardId: board.id } })
    const data = {
      boardName: board.name,
      boardDescription: board.description,
      isActive: true,
      pinCount: boardPinCount(board),
      privacy: board.privacy || 'PUBLIC',
      syncedAt: new Date(),
    }
    if (existing) {
      await db.pinterestBoard.update({ where: { id: existing.id }, data })
    } else {
      await db.pinterestBoard.create({
        data: { connectionId, pinterestBoardId: board.id, ...data },
      })
    }
  }
  await db.pinterestConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: new Date() } })
}

// ─── GET: boards + live summary ─────────────────────────────────────
// For REAL connections the summary is kept live from the Pinterest API
// (auto-sync when the cached data is older than BOARDS_STALE_MS), so
// "Boards with Pins" and "Total Pins on Boards" always reflect Pinterest.
// On any API error the route silently falls back to the DB cache — the
// user still sees the last known numbers instead of an error page.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { connectionId } = Object.fromEntries(req.nextUrl.searchParams)
  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 })

  const conn = await db.pinterestConnection.findFirst({ where: { id: connectionId, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const isRealConnection =
    !!conn.accessToken && !conn.accessToken.startsWith('simulated_') && !!conn.refreshToken

  // Live auto-sync for real connections when the cache is stale/empty.
  // (Same token-refresh-under-lock flow as everywhere else — safe against
  // the worker publishing on this account right now.)
  let liveSynced = false
  if (isRealConnection) {
    const BOARDS_STALE_MS = 3 * 60 * 1000
    const lastSyncedAt = conn.lastSyncedAt ? new Date(conn.lastSyncedAt).getTime() : 0
    if (Date.now() - lastSyncedAt > BOARDS_STALE_MS) {
      const token = await getConnectionAccessToken(connectionId)
      if (token.ok && token.accessToken) {
        try {
          const remoteBoards = await fetchPinterestBoards(token.accessToken)
          recordApiCall(auth.session.userId, 'boards', connectionId)
          await persistRemoteBoards(connectionId, remoteBoards)
          liveSynced = true
        } catch (err: any) {
          // Fall back to the cached rows below — never break the tab on a
          // transient Pinterest error (rate limit, blip, etc.).
          console.error('[boards] Live auto-sync failed (using cached data):', err.message)
        }
      }
    }
  }

  const boards = await db.pinterestBoard.findMany({
    where: { connectionId, isActive: true },
    orderBy: { boardName: 'asc' },
  })
  const summary = summarizeBoards(boards)
  return NextResponse.json({ boards, summary, liveSynced })
}

// ─── POST: explicit "Sync Live from Pinterest" ──────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { connectionId } = await req.json()
  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 })

  const conn = await db.pinterestConnection.findFirst({ where: { id: connectionId, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  // === Real API sync for non-simulated connections ===
  if (conn.accessToken && !conn.accessToken.startsWith('simulated_') && conn.refreshToken) {
    try {
      let accessToken = conn.accessToken
      const now = new Date()
      const tokenExpiry = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null

      // Refresh if expired (within 5 min buffer) — under the SAME per-connection
      // Redis lock the worker uses, so the app and a worker replica can never
      // refresh simultaneously with Pinterest's rotating refresh tokens (that
      // race invalidates one side and forces the user to reconnect).
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
          // A worker replica held the lock for this account the whole window
          // (a long publish retry storm). Tell the user to retry rather than
          // risk a racy refresh.
          return NextResponse.json({ error: 'This account is currently publishing pins. Please try syncing boards again in a few seconds.' }, { status: 503 })
        } else {
          // Redis unreachable — no worker can be mid-publish either, so a
          // direct refresh without the lock is safe.
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

      const remoteBoards = await fetchPinterestBoards(accessToken)
      recordApiCall(auth.session.userId, 'boards', connectionId)
      await persistRemoteBoards(connectionId, remoteBoards)

      const boards = await db.pinterestBoard.findMany({ where: { connectionId, isActive: true }, orderBy: { boardName: 'asc' } })
      const summary = summarizeBoards(boards)
      return NextResponse.json({ boards, synced: true, count: remoteBoards.length, summary })
    } catch (err: any) {
      if (err.message?.includes('invalid_grant') || err.message?.includes('refresh_token')) {
        await db.pinterestConnection.update({ where: { id: connectionId }, data: { status: 'reauth_required' } })
        return NextResponse.json({ error: 'Token expired. Please reconnect your Pinterest account.', needsReauth: true }, { status: 401 })
      }
      // SECURITY: Log full error server-side, return generic message to client
      console.error('[boards] Sync failed:', err.message)
      return NextResponse.json({ error: 'Board sync failed. Please try again or reconnect your Pinterest account.' }, { status: 500 })
    }
  }

  // === Fallback: Simulated board sync ===
  const existing = await db.pinterestBoard.findMany({ where: { connectionId } })
  const existingNames = new Set(existing.map((b) => b.boardName))
  const newBoards = ['Re-synced Board 1', 'Re-synced Board 2']
  for (const name of newBoards) {
    if (!existingNames.has(name)) {
      await db.pinterestBoard.create({ data: { connectionId, pinterestBoardId: 'board_' + Math.random().toString(36).substring(2, 10), boardName: name } })
    }
  }
  await db.pinterestConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: new Date() } })
  const boards = await db.pinterestBoard.findMany({ where: { connectionId, isActive: true }, orderBy: { boardName: 'asc' } })
  const summary = summarizeBoards(boards)
  return NextResponse.json({ boards, synced: true, count: boards.length, summary })
}
