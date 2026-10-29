import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPasswordAsync, buildSessionData, attachSessionCookie, createSessionToken, normalizeEmail, findUserByEmail } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 10 login attempts per minute per IP (prevents brute force)
  const ip = getClientIp(req)
  const rl = checkRateLimit(`login:${ip}`, 10, 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  try {
    const { email: rawEmail, password } = await req.json()
    if (!rawEmail || !password || typeof rawEmail !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }
    // Per-ACCOUNT limit on top of the per-IP one: slows password guessing against one
    // account even from many IPs. Generous enough that a real user is never locked out.
    const acct = checkRateLimit(`login-acct:${normalizeEmail(rawEmail)}`, 20, 15 * 60 * 1000)
    if (!acct.success) {
      return NextResponse.json(
        { error: 'Too many login attempts for this account. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(acct.retryAfterMs / 1000)) } },
      )
    }
    const user = await findUserByEmail(rawEmail)
    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    if (!(await verifyPasswordAsync(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 })
    }
    const session = buildSessionData({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      currentPlanId: user.currentPlanId,
    })
    // `token` is a signed, tamper-proof session used for header-based auth
    // (e.g. webviews that can't rely on cookies). It is opaque to the client.
    const response = NextResponse.json({ user: session, token: createSessionToken(session) })
    return attachSessionCookie(response, session)
  } catch (e: any) {
    // SECURITY: Don't leak internal error details to the client
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 })
  }
}
