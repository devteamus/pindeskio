import { NextRequest, NextResponse } from 'next/server'
import { hashSync, compareSync, hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs'
import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { db } from './db'
import { config } from './config'

const SESSION_COOKIE = 'pinscheduler_session'
const AUTH_HEADER = 'x-session-token'
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7 // 7 days

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
}

/**
 * Produce a tamper-proof, expiring session token: base64url(payload).base64url(hmac)
 * The payload is never trusted unless the signature verifies AND it hasn't expired.
 */
export function createSessionToken(session: SessionData): string {
  const now = Date.now()
  const payload = JSON.stringify({ ...session, iat: now, exp: now + SESSION_MAX_AGE_SEC * 1000 })
  const payloadB64 = base64url(payload)
  const sig = sign(payloadB64)
  return `${payloadB64}.${sig}`
}

function verifySessionToken(token: string): { session: SessionData; iat: number } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts

  const expectedSig = sign(payloadB64)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null // signature invalid — token was forged or corrupted
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null // expired
    const { exp: _exp, iat, ...session } = payload
    return { session: session as SessionData, iat: typeof iat === 'number' ? iat : 0 }
  } catch {
    return null
  }
}

export function hashPassword(password: string): string {
  return hashSync(password, 10)
}

export function verifyPassword(password: string, hash: string): boolean {
  return compareSync(password, hash)
}

// Async variants for request handlers: hashSync/compareSync block the Node event loop
// for ~60-100ms per call, so a burst of logins froze every other request on the server.
export async function hashPasswordAsync(password: string): Promise<string> {
  return bcryptHash(password, 10)
}

export async function verifyPasswordAsync(password: string, hash: string): Promise<boolean> {
  return bcryptCompare(password, hash)
}

// ─── Email helpers ───────────────────────────────────────────────────
// Emails used to be stored exactly as typed, while forgot-/reset-password looked them
// up lowercased — so any account registered with a capital letter could never reset its
// password, and "A@x.com" / "a@x.com" could register as two accounts.
export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase()
}

/** Lookup that also finds legacy rows stored with their original casing. */
export async function findUserByEmail(email: string) {
  const lower = normalizeEmail(email)
  const exact = await db.user.findUnique({ where: { email: lower } })
  if (exact) return exact
  return db.user.findFirst({ where: { email: { equals: lower, mode: 'insensitive' } } })
}

export interface SessionData {
  userId: string
  email: string
  name: string | null
  role: string
  status: string
  currentPlanId: string | null
}

export function buildSessionData(user: { id: string; email: string; name: string | null; role: string; status: string; currentPlanId: string | null }) {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    currentPlanId: user.currentPlanId,
  }
}

export function attachSessionCookie(response: NextResponse, session: ReturnType<typeof buildSessionData>) {
  response.cookies.set(SESSION_COOKIE, createSessionToken(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SEC,
    path: '/',
  })
  return response
}

async function readSession(req?: NextRequest): Promise<{ session: SessionData; iat: number } | null> {
  // 1. Try Authorization header first (works in iframes/webviews) — must be a
  //    server-signed token (see createSessionToken). A raw/forged JSON blob will
  //    fail signature verification and is ignored.
  if (req) {
    const headerToken = req.headers.get(AUTH_HEADER)
    if (headerToken) {
      const parsed = verifySessionToken(headerToken)
      if (parsed) return parsed
    }
  }

  // 2. Fall back to cookie (also a signed token, never trusted without verification)
  const cookie = await cookies()
  const raw = cookie.get(SESSION_COOKIE)?.value
  if (!raw) return null
  return verifySessionToken(raw)
}

export async function getSession(req?: NextRequest): Promise<SessionData | null> {
  return (await readSession(req))?.session ?? null
}

export async function destroySession() {
  const cookie = await cookies()
  cookie.delete(SESSION_COOKIE)
}

export async function requireAuth(req?: NextRequest) {
  const parsed = await readSession(req)
  if (!parsed) {
    return { error: 'Unauthorized', status: 401, session: null }
  }
  const session = parsed.session
  // Verify user still exists and is active
  const user = await db.user.findUnique({ where: { id: session.userId } })
  if (!user || user.status === 'suspended') {
    return { error: 'Account suspended', status: 403, session: null }
  }
  // Token issued before the user logged out / reset their password → revoked.
  if (user.sessionsValidFrom && parsed.iat < user.sessionsValidFrom.getTime()) {
    return { error: 'Session expired. Please log in again.', status: 401, session: null }
  }
  if (user.status === 'pending' && user.role !== 'super_admin') {
    return { error: 'Account pending approval', status: 403, session: null }
  }
  // Return session refreshed from DB (never trust client-sent role/status)
  const dbSession: SessionData = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    currentPlanId: user.currentPlanId,
  }
  return { error: null, status: 200, session: dbSession, user }
}

export async function requireAdmin(req?: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return auth
  // SECURITY: Always check role from DB, NEVER from client-sent session
  if (auth.user.role !== 'admin' && auth.user.role !== 'super_admin') {
    return { error: 'Admin access required', status: 403, session: null, user: null }
  }
  return auth
}
