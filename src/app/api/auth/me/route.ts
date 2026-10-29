import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, attachSessionCookie, createSessionToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // Use requireAuth (not raw getSession) so role/plan/status are always
  // re-read from the DB rather than trusted from the (signed) token as-is.
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) {
    return NextResponse.json({ error: auth.error || 'Not authenticated' }, { status: auth.status })
  }
  // Refresh the cookie/token with the latest DB-backed data + a renewed expiry.
  const response = NextResponse.json({ user: auth.session, token: createSessionToken(auth.session) })
  return attachSessionCookie(response, auth.session)
}
