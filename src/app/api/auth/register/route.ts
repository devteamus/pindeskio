import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPasswordAsync, buildSessionData, attachSessionCookie, createSessionToken, normalizeEmail, findUserByEmail } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 5 registrations per hour per IP (prevents spam account creation)
  const ip = getClientIp(req)
  const rl = checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  try {
    const body = await req.json()
    const { password, name } = body
    if (!body.email || typeof body.email !== 'string' || !password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }
    // Stored lowercase so login / forgot-password / duplicate checks all agree
    const email = normalizeEmail(body.email)
    // Input validation: basic email format check
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }
    // Cap name length to prevent abuse
    const safeName = name ? String(name).slice(0, 100) : null

    const existing = await findUserByEmail(email)
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    const freePlan = await db.plan.findUnique({ where: { id: 'plan_free' } })
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPasswordAsync(password),
        name: safeName,
        status: 'active',
        currentPlanId: freePlan?.id || null,
      },
    })
    const session = buildSessionData({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      currentPlanId: user.currentPlanId,
    })
    const response = NextResponse.json({ user: session, token: createSessionToken(session) })
    return attachSessionCookie(response, session)
  } catch (e: any) {
    // Two simultaneous registrations of the same email: the unique index rejects the second
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    // SECURITY: Don't leak internal error details (e.g. DB constraint names)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}
