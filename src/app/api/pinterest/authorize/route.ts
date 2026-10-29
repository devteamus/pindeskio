import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { config } from '@/lib/config'
import { getAuthorizeUrl } from '@/lib/pinterest'
import { requireAuth } from '@/lib/auth'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!config.pinterestAppId || !config.pinterestRedirectUri) {
    return NextResponse.json(
      { error: 'Pinterest OAuth is not configured. Set PINTEREST_APP_ID and PINTEREST_REDIRECT_URI.' },
      { status: 500 }
    )
  }

  // Generate CSRF state token
  const state = randomUUID()

  // Store state + userId in a short-lived cookie for callback verification
  const cookieStore = await cookies()
  cookieStore.set('pinterest_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  // Also store which user initiated this (for callback)
  cookieStore.set('pinterest_oauth_user', auth.session.userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const authorizeUrl = getAuthorizeUrl(state)

  return NextResponse.json({ url: authorizeUrl })
}
