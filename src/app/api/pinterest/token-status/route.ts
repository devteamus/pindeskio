import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isTokenExpired, isRefreshTokenExpired } from '@/lib/pinterest'

/**
 * GET /api/pinterest/token-status?connectionId=xxx
 * Returns whether a connection's token is valid, expired, or needs reauth.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const connectionId = req.nextUrl.searchParams.get('connectionId')
  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 })

  const conn = await db.pinterestConnection.findFirst({
    where: { id: connectionId, userId: auth.session.userId },
    select: { id: true, status: true, tokenExpiresAt: true, refreshTokenExpiresAt: true, accessToken: true },
  })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const isSimulated = !conn.accessToken || conn.accessToken.startsWith('simulated_')

  if (isSimulated) {
    return NextResponse.json({
      connectionId: conn.id,
      status: conn.status,
      tokenStatus: 'simulated',
      needsReauth: false,
      message: 'Simulated connection (demo mode)',
    })
  }

  const tokenExpired = isTokenExpired(conn.tokenExpiresAt)
  const refreshTokenExpired = isRefreshTokenExpired(conn.refreshTokenExpiresAt)

  let tokenStatus: 'valid' | 'expired_refreshable' | 'reauth_required'
  let needsReauth = false

  if (conn.status === 'reauth_required' || refreshTokenExpired) {
    tokenStatus = 'reauth_required'
    needsReauth = true
  } else if (tokenExpired) {
    tokenStatus = 'expired_refreshable'
  } else {
    tokenStatus = 'valid'
  }

  return NextResponse.json({
    connectionId: conn.id,
    status: conn.status,
    tokenStatus,
    needsReauth,
    // SECURITY: Don't expose exact token expiry timestamps to the frontend.
    // Only expose whether reauth is needed — that's all the UI needs.
  })
}
