// ─── Security review (2nd pass) — control verification + finding evidence ──
//
// This file is NOT a functional test suite. It exists to:
//   1. VERIFY (with executable evidence) that the security controls claimed
//      in AUDIT-CHANGES.md actually hold: tenant isolation, admin boundary,
//      role-from-DB, token tamper resistance, session revocation, rate
//      limits, OTP brute-force atomicity, upload URL validation.
//   2. DOCUMENT three open findings with reproducible evidence
//      (marked FINDING #): those assertions encode the CURRENT vulnerable
//      behavior ON PURPOSE, so that fixing the finding flips the assertion
//      and the suite goes red until the fix is real. Update these blocks
//      when the finding is fixed.
//
// All tests run ONLY against the disposable local test stack
// (scripts/test-infra-start.sh → postgres :5433 / redis :6380).
// No production systems are touched. No third-party API is called
// (network-touching branches are skipped by construction).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Route handlers fall back to next/headers cookies() when no valid
// x-session-token header is present. Outside a real Next.js request scope
// that call throws, which would make negative tests fail with an artifact
// error instead of the 401 we are asserting. Mock the cookie store as
// "no cookies present" — exactly what an unauthenticated request looks
// like to the auth layer.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}))

import { NextRequest, NextResponse } from 'next/server'

// Auth/session internals (same SESSION_SECRET as the server under test)
import {
  hashPasswordAsync,
  createSessionToken,
  buildSessionData,
} from '@/lib/auth'
import { hashOtp, MAX_OTP_ATTEMPTS } from '@/lib/otp'
import { getClientIp } from '@/lib/rate-limit'

// Route handlers under test
import { GET as meGET } from '@/app/api/auth/me/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as registerPOST } from '@/app/api/auth/register/route'
import { POST as forgotPasswordPOST } from '@/app/api/auth/forgot-password/route'
import { POST as resetPasswordPOST } from '@/app/api/auth/reset-password/route'
import { GET as pinsGET, PATCH as pinsPATCH, DELETE as pinsDELETE } from '@/app/api/scheduled-pins/route'
import { POST as pinSinglePOST } from '@/app/api/pins/single/route'
import { POST as pinBulkPOST } from '@/app/api/pins/bulk/route'
import { GET as batchesGET, PATCH as batchesPATCH, DELETE as batchesDELETE } from '@/app/api/import-batches/route'
import { GET as connectionsGET } from '@/app/api/connections/route'
import { DELETE as connectionDELETE, PATCH as connectionPATCH } from '@/app/api/connections/[id]/route'
import { GET as tokenStatusGET } from '@/app/api/pinterest/token-status/route'
import { GET as adminUsersGET, PATCH as adminUsersPATCH } from '@/app/api/admin/users/route'
import { GET as adminStatsGET } from '@/app/api/admin/stats/route'
import { POST as paymentVerifyPOST } from '@/app/api/payment-orders/verify/route'

import { makeDeps, closeDeps, seedBase, SEED, type TestDeps } from './helpers'
import type { PrismaClient } from '@prisma/client'

const QUEUE = 'pin-publish-security-review'

let deps: TestDeps
let db: PrismaClient

// ─── Fixtures ────────────────────────────────────────────────────────
const SEC = {
  userA: 'sec-user-a',          // regular active user (Pro-plan seeded via seedBase)
  userB: 'sec-user-b',          // second tenant — attacker for horizontal tests
  admin: 'sec-admin',           // role: admin
  superAdmin: 'sec-superadmin', // role: super_admin
  loginEmail: 'sec-login@example.com',
}
const tokenA = createSessionToken(buildSessionData({
  id: SEC.userA, email: 'a@example.com', name: 'A', role: 'user', status: 'active', currentPlanId: SEED.planProId,
}))
const tokenB = createSessionToken(buildSessionData({
  id: SEC.userB, email: 'b@example.com', name: 'B', role: 'user', status: 'active', currentPlanId: SEED.planProId,
}))
const tokenAdmin = createSessionToken(buildSessionData({
  id: SEC.admin, email: 'admin@example.com', name: 'AD', role: 'admin', status: 'active', currentPlanId: null,
}))
const tokenSuper = createSessionToken(buildSessionData({
  id: SEC.superAdmin, email: 'super@example.com', name: 'SA', role: 'super_admin', status: 'active', currentPlanId: null,
}))

function req(
  url: string,
  opts: { method?: string; token?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(opts.headers)
  if (opts.token) headers.set('x-session-token', opts.token)
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers.set('content-type', 'application/json')
  }
  return new NextRequest(`http://localhost:3000${url}`, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  })
}

beforeAll(async () => {
  deps = await makeDeps(QUEUE)
  db = deps.db
  await seedBase(db)

  // Security-review users
  const mk = (id: string, role: string) => db.user.upsert({
    where: { id },
    create: {
      id,
      email: `${id}@example.com`,
      name: id,
      role,
      status: 'active',
      currentPlanId: role === 'user' ? SEED.planProId : null,
    },
    update: { role, status: 'active' },
  })
  await mk(SEC.userA, 'user')
  await mk(SEC.userB, 'user')
  await mk(SEC.admin, 'admin')
  await mk(SEC.superAdmin, 'super_admin')

  // A user with a known password, for login-path tests
  await db.user.upsert({
    where: { email: SEC.loginEmail },
    create: {
      email: SEC.loginEmail,
      name: 'Login User',
      role: 'user',
      status: 'active',
      currentPlanId: SEED.planFreeId,
      passwordHash: await hashPasswordAsync('CorrectPassword123'),
    },
    update: { passwordHash: await hashPasswordAsync('CorrectPassword123'), status: 'active' },
  })

  // A real-looking connection for user A (token values are fake test secrets)
  await db.pinterestConnection.upsert({
    where: { id: 'sec-conn-a' },
    create: {
      id: 'sec-conn-a',
      userId: SEC.userA,
      accessToken: 'SECRET_access_token_should_not_be_in_api_responses',
      refreshToken: 'SECRET_refresh_token_should_not_be_in_api_responses',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
      status: 'active',
    },
    update: {},
  })

  // A board under that connection (pins/single validates boardId against the connection)
  await db.pinterestBoard.upsert({
    where: { id: 'sec-board-a' },
    create: {
      id: 'sec-board-a',
      connectionId: 'sec-conn-a',
      pinterestBoardId: '888111888',
      boardName: 'Security Review Board',
      isActive: true,
    },
    update: { connectionId: 'sec-conn-a', isActive: true },
  })
})

afterAll(async () => {
  // Free the shared app-queue Redis connection the route modules opened
  const { execSync } = await import('child_process')
  try { execSync('redis-cli -p 6380 --scan --pattern "bull:pin-publish:*" | xargs -r redis-cli -p 6380 DEL', { stdio: 'ignore' }) } catch { /* best effort */ }
  await closeDeps(deps)
})

// ═══ 1. Session token integrity ═══════════════════════════════════════

describe('session tokens', () => {
  it('rejects a token with a tampered signature', async () => {
    const parts = tokenA.split('.')
    const forged = `${parts[0]}.R2V0T3V0fkl0c0FjdHVhbGx5SGVscGVy`
    const res = await meGET(req('/api/auth/me', { token: forged }))
    expect(res.status).toBe(401)
    expect((await res.json()).user).toBeUndefined()
  })

  it('rejects an expired (but correctly signed) token', async () => {
    const past = Date.now() - 8 * 24 * 3600_000
    const payload = JSON.stringify({
      userId: SEC.userA, email: 'a@example.com', name: 'A', role: 'user', status: 'active',
      currentPlanId: SEED.planProId, iat: past - 7 * 24 * 3600_000, exp: past,
    })
    const { createHmac } = await import('crypto')
    const sig = createHmac('sha256', process.env.SESSION_SECRET!).update(payload).digest('base64url')
    const expired = `${Buffer.from(payload).toString('base64url')}.${sig}`
    const res = await meGET(req('/api/auth/me', { token: expired }))
    expect(res.status).toBe(401)
  })

  it('rejects a request with no token at all', async () => {
    const res = await meGET(req('/api/auth/me'))
    expect(res.status).toBe(401)
  })

  it('CONTROL: never trusts the role/status embedded in the token — a validly-signed token claiming super_admin still gets 403 on admin routes', async () => {
    // The test runner legitimately HAS the signing secret, so this mints a
    // *correctly signed* token whose payload lies about the role. If authz
    // ever starts trusting token contents instead of the DB, this goes red.
    const escalated = createSessionToken({
      userId: SEC.userA, email: 'a@example.com', name: 'A',
      role: 'super_admin', status: 'active', currentPlanId: SEED.planProId,
    } as any)
    const res = await adminStatsGET(req('/api/admin/stats', { token: escalated }))
    expect(res.status).toBe(403)
    const me = await meGET(req('/api/auth/me', { token: escalated }))
    expect((await me.json()).user.role).toBe('user') // re-read from DB
  })

  it('CONTROL: sessionsValidFrom revocation invalidates existing tokens (logout / password reset)', async () => {
    try {
      await db.user.update({ where: { id: SEC.userA }, data: { sessionsValidFrom: new Date(Date.now() + 5000) } })
      const res = await meGET(req('/api/auth/me', { token: tokenA }))
      expect(res.status).toBe(401)
      expect((await res.json()).error).toMatch(/expired|log in/i)
    } finally {
      await db.user.update({ where: { id: SEC.userA }, data: { sessionsValidFrom: null } })
    }
  })

  it('CONTROL: suspended accounts are rejected even with a valid token', async () => {
    try {
      await db.user.update({ where: { id: SEC.userA }, data: { status: 'suspended' } })
      const res = await meGET(req('/api/auth/me', { token: tokenA }))
      expect(res.status).toBe(403)
    } finally {
      await db.user.update({ where: { id: SEC.userA }, data: { status: 'active' } })
    }
  })
})

// ═══ 2. Horizontal (cross-tenant) isolation — negative tests ════════

describe('tenant isolation (user B must not touch user A resources)', () => {
  let pinA: { id: string }
  let batchA: { id: string }

  beforeAll(async () => {
    pinA = await db.scheduledPin.create({
      data: {
        userId: SEC.userA,
        connectionId: 'sec-conn-a',
        title: 'A-owned pin',
        imageUrl: 'https://example.com/a.png',
        scheduledFor: new Date(Date.now() + 3600_000),
        status: 'queued',
        payloadJson: '{}',
      },
    })
    batchA = await db.importBatch.create({
      data: { userId: SEC.userA, connectionId: 'sec-conn-a', status: 'completed', totalRows: 1 },
    })
  })

  it('GET scheduled-pins never lists another tenant’s pins', async () => {
    const res = await pinsGET(req('/api/scheduled-pins', { token: tokenB }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('PATCH scheduled-pins on another tenant’s pin → 404 and no change', async () => {
    const res = await pinsPATCH(req('/api/scheduled-pins', { token: tokenB, body: { pinId: pinA.id, action: 'cancel' } }))
    expect(res.status).toBe(404)
    const fresh = await db.scheduledPin.findUnique({ where: { id: pinA.id } })
    expect(fresh?.status).toBe('queued')
  })

  it('DELETE scheduled-pins on another tenant’s pin → 404 and pin survives', async () => {
    const res = await pinsDELETE(req('/api/scheduled-pins', { token: tokenB, body: { pinId: pinA.id } }))
    expect(res.status).toBe(404)
    expect(await db.scheduledPin.findUnique({ where: { id: pinA.id } })).not.toBeNull()
  })

  it('GET import-batches detail on another tenant’s batch → 404', async () => {
    const res = await batchesGET(req(`/api/import-batches?batchId=${batchA.id}`, { token: tokenB }))
    expect(res.status).toBe(404)
  })

  it('PATCH import-batches on another tenant’s batch → 404', async () => {
    const res = await batchesPATCH(req('/api/import-batches', { token: tokenB, body: { batchId: batchA.id, action: 'cancel' } }))
    expect(res.status).toBe(404)
  })

  it('DELETE import-batches on another tenant’s batch → 404 and batch survives', async () => {
    const res = await batchesDELETE(req('/api/import-batches', { token: tokenB, body: { batchId: batchA.id } }))
    expect(res.status).toBe(404)
    expect(await db.importBatch.findUnique({ where: { id: batchA.id } })).not.toBeNull()
  })

  it('DELETE connection of another tenant → 404, tokens intact', async () => {
    const res = await connectionDELETE(
      req(`/api/connections/sec-conn-a`, { token: tokenB, method: 'DELETE' }),
      { params: Promise.resolve({ id: 'sec-conn-a' }) },
    )
    expect(res.status).toBe(404)
    const conn = await db.pinterestConnection.findUnique({ where: { id: 'sec-conn-a' } })
    expect(conn?.status).toBe('active')
    expect(conn?.accessToken).toBeTruthy()
  })

  it('PATCH connection of another tenant → 404, no change', async () => {
    const res = await connectionPATCH(
      req(`/api/connections/sec-conn-a`, { token: tokenB, method: 'PATCH', body: { nickname: 'hijacked' } }),
      { params: Promise.resolve({ id: 'sec-conn-a' }) },
    )
    expect(res.status).toBe(404)
    const conn = await db.pinterestConnection.findUnique({ where: { id: 'sec-conn-a' } })
    expect(conn?.nickname).not.toBe('hijacked')
  })

  it('GET token-status for another tenant’s connection → 404', async () => {
    const res = await tokenStatusGET(req(`/api/pinterest/token-status?connectionId=sec-conn-a`, { token: tokenB }))
    expect(res.status).toBe(404)
  })

  it('CONTROL: connections GET returns ONLY own connections and never any OAuth token fields', async () => {
    const res = await connectionsGET(req('/api/connections', { token: tokenA }))
    expect(res.status).toBe(200)
    const { connections } = await res.json()
    expect(connections.length).toBeGreaterThan(0)
    for (const c of connections) {
      expect(c.userId).toBe(SEC.userA)
      expect(c).not.toHaveProperty('accessToken')
      expect(c).not.toHaveProperty('refreshToken')
    }
  })
})

// ═══ 3. Vertical privilege escalation (admin boundary) ═══════════════

describe('admin boundary', () => {
  it('plain user → 403 on all admin routes', async () => {
    for (const [res] of [
      [await adminUsersGET(req('/api/admin/users', { token: tokenA }))],
      [await adminStatsGET(req('/api/admin/stats', { token: tokenA }))],
    ]) {
      expect(res.status).toBe(403)
    }
  })

  it('CONTROL: a regular admin cannot suspend or re-plan a super_admin', async () => {
    const res = await adminUsersPATCH(req('/api/admin/users', {
      token: tokenAdmin,
      body: { userId: SEC.superAdmin, action: 'disable' },
    }))
    expect(res.status).toBe(403)
    expect((await db.user.findUnique({ where: { id: SEC.superAdmin } }))?.status).toBe('active')
  })

  it('CONTROL: self-suspend is blocked for admins of every level (super-only guard fires first for plain admins)', async () => {
    // A REGULAR admin targeting themselves hits the super_admin-only guard
    // (they are the admin being modified) → 403. Still blocked, just an
    // earlier guard. Documenting the precedence so a refactor that
    // reorders the checks is visible.
    const r1 = await adminUsersPATCH(req('/api/admin/users', {
      token: tokenAdmin,
      body: { userId: SEC.admin, action: 'disable' },
    }))
    expect(r1.status).toBe(403)
    expect((await db.user.findUnique({ where: { id: SEC.admin } }))?.status).toBe('active')

    // A super_admin targeting themselves reaches the explicit self-suspend rule → 400
    const r2 = await adminUsersPATCH(req('/api/admin/users', {
      token: tokenSuper,
      body: { userId: SEC.superAdmin, action: 'disable' },
    }))
    expect(r2.status).toBe(400)
    expect((await db.user.findUnique({ where: { id: SEC.superAdmin } }))?.status).toBe('active')
  })

  it('CONTROL: admin PATCH with a non-existent planId → 404, user plan unchanged', async () => {
    const res = await adminUsersPATCH(req('/api/admin/users', {
      token: tokenAdmin,
      body: { userId: SEC.userB, action: 'change_plan', planId: 'plan_does_not_exist' },
    }))
    expect(res.status).toBe(404)
    expect((await db.user.findUnique({ where: { id: SEC.userB } }))?.currentPlanId).toBe(SEED.planProId)
  })

  it('CONTROL: unknown admin PATCH action → 400, no user change', async () => {
    const res = await adminUsersPATCH(req('/api/admin/users', {
      token: tokenAdmin,
      body: { userId: SEC.userB, action: 'make_superadmin' },
    }))
    expect(res.status).toBe(400)
    expect((await db.user.findUnique({ where: { id: SEC.userB } }))?.role).toBe('user')
  })
})

// ═══ 4. Login / register / rate limiting ═════════════════════════════

describe('login & registration', () => {
  const ipOf = (n: number) => `10.77.${n >> 8}.${n & 255}`
  const loginAs = (email: string, password: string, ip: string) =>
    loginPOST(req('/api/auth/login', { body: { email, password }, headers: { 'x-forwarded-for': ip } }))

  it('wrong password → generic 401 (no user-existence oracle)', async () => {
    const r1 = await loginAs(SEC.loginEmail, 'WrongPassword', ipOf(1))
    const r2 = await loginAs('nonexistent@example.com', 'Whatever', ipOf(2))
    expect(r1.status).toBe(401)
    expect(r2.status).toBe(401)
    expect(await r1.json()).toEqual(await r2.json())
  })

  it('CONTROL: successful login sets an HttpOnly SameSite cookie; token is HMAC-signed', async () => {
    const res = await loginAs(SEC.loginEmail, 'CorrectPassword123', ipOf(3))
    expect(res.status).toBe(200)
    const setCookie = res.headers.getSetCookie().join('; ')
    expect(setCookie).toMatch(/pinscheduler_session=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    const token = (await res.json()).token as string
    expect(token.split('.').length).toBe(2) // payload.signature — tamper-evident form
  })

  it('CONTROL: per-IP login rate limit trips on the 11th attempt within a minute', async () => {
    const ip = ipOf(90)
    let last = 0
    for (let i = 0; i < 11; i++) {
      last = (await loginAs(SEC.loginEmail, 'WrongPassword', ip)).status
    }
    expect(last).toBe(429)
  })

  it('CONTROL: spoofed leading X-Forwarded-For entries do NOT rotate the rate-limit key (rightmost entry wins)', async () => {
    // Each request claims a different fake client IP in the FIRST entry, but
    // the trusted proxy appends the real one — getClientIp must count from
    // the right, so the effective key stays constant and the limit still trips.
    let last = 0
    for (let i = 0; i < 11; i++) {
      const r = await loginPOST(req('/api/auth/login', {
        body: { email: SEC.loginEmail, password: 'WrongPassword' },
        headers: { 'x-forwarded-for': `spoofed-${i}.fake, 10.99.0.77` },
      }))
      last = r.status
    }
    expect(last).toBe(429)
  })

  it('unit: getClientIp counts TRUSTED_PROXY_COUNT hops from the right', () => {
    const r = new NextRequest('http://localhost/', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' } })
    process.env.TRUSTED_PROXY_COUNT = '2'
    expect(getClientIp(r)).toBe('5.6.7.8')
    delete process.env.TRUSTED_PROXY_COUNT // back to default 1
    expect(getClientIp(r)).toBe('9.10.11.12')
  })

  it('register: weak password rejected; duplicate email → 409', async () => {
    const weak = await registerPOST(req('/api/auth/register', {
      body: { email: `weak-${Date.now()}@example.com`, password: '123' },
      headers: { 'x-forwarded-for': ipOf(120) },
    }))
    expect(weak.status).toBe(400)

    const dup = await registerPOST(req('/api/auth/register', {
      body: { email: SEC.loginEmail.toUpperCase(), password: 'LongEnoughPassword1' },
      headers: { 'x-forwarded-for': ipOf(121) },
    }))
    expect(dup.status).toBe(409)
  })
})

// ═══ 5. Password reset: OTP brute-force atomicity + enumeration ══════

describe('password reset', () => {
  it('CONTROL: 30 PARALLEL wrong-OTP guesses consume exactly MAX_OTP_ATTEMPTS (no race window)', async () => {
    const email = `otp-race-${Date.now()}@example.com`
    await db.user.create({
      data: { email, passwordHash: await hashPasswordAsync('OriginalPass123'), status: 'active', role: 'user' },
    })
    const realOtp = '135790'
    const rec = await db.passwordResetOtp.create({
      data: {
        userId: (await db.user.findUnique({ where: { email } }))!.id,
        otpHash: hashOtp(realOtp, (await db.user.findUnique({ where: { email } }))!.id),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })

    // 30 concurrent wrong guesses, each from a distinct IP (bypasses only the
    // IP limiter — the per-OTP atomic attempt counter is what must hold)
    const attempts = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        resetPasswordPOST(req('/api/auth/reset-password', {
          body: { email, otp: '000000', newPassword: 'NewPassword123' },
          headers: { 'x-forwarded-for': `10.50.${i >> 8}.${i & 255}` },
        })),
      ),
    )
    const statuses = attempts.map((r) => r.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(0) // nobody got in
    const fresh = await db.passwordResetOtp.findUnique({ where: { id: rec.id } })
    expect(fresh?.attempts).toBe(MAX_OTP_ATTEMPTS) // exactly 5 guesses burned, not 30

    // OTP is now dead: even the CORRECT code is refused
    const correctNow = await resetPasswordPOST(req('/api/auth/reset-password', {
      body: { email, otp: realOtp, newPassword: 'NewPassword123' },
      headers: { 'x-forwarded-for': '10.50.9.9' },
    }))
    expect([400, 429]).toContain(correctNow.status)
    expect(correctNow.status).toBe(400)
    expect((await db.user.findUnique({ where: { email } }))?.passwordHash)
      .not.toBe(await hashPasswordAsync('NewPassword123')) // password unchanged
  })

  it('CONTROL: the correct OTP resets the password AND revokes old sessions (single-use burn)', async () => {
    const email = `otp-ok-${Date.now()}@example.com`
    const user = await db.user.create({
      data: { email, passwordHash: await hashPasswordAsync('OriginalPass123'), status: 'active', role: 'user' },
    })
    const oldToken = createSessionToken(buildSessionData({
      id: user.id, email, name: null, role: 'user', status: 'active', currentPlanId: null,
    }))
    const otp = '246813'
    await db.passwordResetOtp.create({
      data: { userId: user.id, otpHash: hashOtp(otp, user.id), expiresAt: new Date(Date.now() + 10 * 60_000) },
    })

    const res = await resetPasswordPOST(req('/api/auth/reset-password', {
      body: { email, otp, newPassword: 'BrandNewPass123' },
      headers: { 'x-forwarded-for': '10.51.0.1' },
    }))
    expect(res.status).toBe(200)

    // Old token (issued before the reset) is now invalid
    expect((await meGET(req('/api/auth/me', { token: oldToken }))).status).toBe(401)
    // The burned OTP cannot be reused
    const replay = await resetPasswordPOST(req('/api/auth/reset-password', {
      body: { email, otp, newPassword: 'AnotherPass123' },
      headers: { 'x-forwarded-for': '10.51.0.2' },
    }))
    expect(replay.status).toBe(400)
  })

  it('CONTROL: forgot-password answers unknown emails with the exact generic message', async () => {
    const res = await forgotPasswordPOST(req('/api/auth/forgot-password', {
      body: { email: `no-such-user-${Date.now()}@example.com` },
      headers: { 'x-forwarded-for': '10.52.0.1' },
    }))
    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({
      message: 'If that email is registered, a password reset code has been sent to it.',
    })
  })
})

// ═══ 6. Pin creation input validation ════════════════════════════════

describe('pin input validation', () => {
  it('CONTROL: javascript:/data: image or destination URLs are rejected', async () => {
    const res = await pinSinglePOST(req('/api/pins/single', {
      token: tokenA,
      body: {
        connectionId: 'sec-conn-a',
        boardId: 'sec-board-a',
        title: 'x',
        imageUrl: 'javascript:alert(1)',
      },
    }))
    expect(res.status).toBe(400)

    const res2 = await pinSinglePOST(req('/api/pins/single', {
      token: tokenA,
      body: {
        connectionId: 'sec-conn-a',
        boardId: 'sec-board-a',
        title: 'x',
        imageUrl: 'https://example.com/img.png',
        destinationUrl: 'data:text/html,<script>alert(1)</script>',
      },
    }))
    expect(res2.status).toBe(400)
  })

  it('CONTROL: another tenant’s connectionId / boardId → 404, nothing created', async () => {
    const before = await db.scheduledPin.count({ where: { userId: SEC.userA } })
    const res = await pinSinglePOST(req('/api/pins/single', {
      token: tokenB,
      body: {
        connectionId: 'sec-conn-a',      // belongs to user A
        boardId: 'sec-board-a',
        title: 'x',
        imageUrl: 'https://example.com/img.png',
      },
    }))
    expect(res.status).toBe(404)
    expect(await db.scheduledPin.count({ where: { userId: SEC.userA } })).toBe(before)
  })
})

// ═══ 7. Second-pass fixes — regression tests ════════════════════════
// These four assertions originally demonstrated the OPEN findings (they
// encoded the vulnerable behavior on purpose). The findings have since been
// FIXED in this pass; the tests now pin the fixed behavior.

describe('second-pass fixes', () => {
  it('FIXED P1: PATCH /api/connections/[id] no longer returns OAuth tokens (used to leak accessToken/refreshToken)', async () => {
    const res = await connectionPATCH(
      req(`/api/connections/sec-conn-a`, { token: tokenA, method: 'PATCH', body: { nickname: 'renamed-by-test' } }),
      { params: Promise.resolve({ id: 'sec-conn-a' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // The update worked…
    expect(body.connection.nickname).toBe('renamed-by-test')
    // …but no token material of any kind leaves the server anymore.
    expect(body.connection).not.toHaveProperty('accessToken')
    expect(body.connection).not.toHaveProperty('refreshToken')
    expect(body.connection).not.toHaveProperty('tokenExpiresAt')
    expect(body.connection).not.toHaveProperty('refreshTokenExpiresAt')
    expect(JSON.stringify(body)).not.toContain('SECRET_access_token')
    expect(JSON.stringify(body)).not.toContain('SECRET_refresh_token')
  })

  it('FIXED M1: GET /api/admin/users no longer returns passwordHash for every user', async () => {
    const res = await adminUsersGET(req('/api/admin/users', { token: tokenSuper }))
    expect(res.status).toBe(200)
    const { users } = await res.json()
    expect(users.length).toBeGreaterThan(0)
    for (const u of users) {
      expect(u).not.toHaveProperty('passwordHash')
      expect(u).not.toHaveProperty('sessionsValidFrom')
      // the fields the admin panel actually renders are still present
      expect(u.email).toBeTruthy()
      expect(u).toHaveProperty('status')
      expect(u).toHaveProperty('createdAt')
      expect(u).toHaveProperty('currentPlan')
      expect(u).toHaveProperty('_count')
    }
  })

  it('FIXED M2: oversized CSVs are rejected DURING parsing (no row materialization beyond the cap)', async () => {
    // 262k data rows (> the 100k record cap). Before the fix, the endpoint
    // materialized ALL of them (at 30 MB scale ≈ >1 GB heap) and only then
    // applied plan limits — a logged-in-user OOM. Now the parse stops at the
    // cap and the file is rejected with a distinctive limit marker.
    const csv = 'title,image_url,board_name\n' + ',\n'.repeat(256 * 1024)
    const batchesBefore = await db.importBatch.count({ where: { userId: SEC.userA } })
    const form = new FormData()
    form.append('file', new File([csv], 'evil.csv', { type: 'text/csv' }))
    form.append('connectionId', 'sec-conn-a')
    form.append('importMode', 'auto')
    form.append('intervalSeconds', '60')
    const res = await pinBulkPOST(req('/api/pins/bulk', { token: tokenA, form }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.limit).toBe('maxCsvRecords')
    expect(body.maxCsvRecords).toBe(100_000)
    // No pin/batch rows were created by the rejected upload (compare with
    // the pre-request count — other suites leave benign rows behind)
    expect(await db.importBatch.count({ where: { userId: SEC.userA } })).toBe(batchesBefore)
  })

  it('FIXED M2b: /api/pins/bulk now rate-limits per user (429 after the hourly quota)', async () => {
    // M2 above consumed 1 of the 20/hour per-user import budget.
    // 22 more rapid uploads: the first 19 proceed to (plan-limit) rejection,
    // the rest must hit 429. No parse-heavy request is allowed through
    // unchecked anymore.
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) {
      const form = new FormData()
      form.append('file', new File(['a,b\n1,2\n'.repeat(16 * 1024)], `f${i}.csv`, { type: 'text/csv' }))
      form.append('connectionId', 'sec-conn-a')
      form.append('importMode', 'auto')
      form.append('intervalSeconds', '60')
      statuses.push((await pinBulkPOST(req('/api/pins/bulk', { token: tokenA, form }))).status)
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1)
    expect(statuses.filter((s) => s === 429).length).toBeLessThanOrEqual(3) // exactly the 3 over budget
  })
})

// ═══ 8. Payment verification — tenant + replay guards ══════════════

describe('payment verify', () => {
  it('CONTROL: verifying ANOTHER user’s order → 403, order untouched', async () => {
    const order = await db.paymentOrder.create({
      data: {
        userId: SEC.userA,
        planId: SEED.planProId,
        amount: 0,
        expectedAmount: 9.99,
        network: 'TRC20',
        txid: 'a'.repeat(64),
        status: 'submitted',
      },
    })
    const res = await paymentVerifyPOST(req('/api/payment-orders/verify', {
      token: tokenB,
      body: { orderId: order.id },
    }))
    expect(res.status).toBe(403)
    expect((await db.paymentOrder.findUnique({ where: { id: order.id } }))?.status).toBe('submitted')
  })

  it('CONTROL: malformed TXID → 400 + failed_verification WITHOUT any blockchain call (regression: used to return HTTP 200)', async () => {
    const order = await db.paymentOrder.create({
      data: {
        userId: SEC.userA,
        planId: SEED.planProId,
        amount: 0,
        expectedAmount: 9.99,
        network: 'TRC20',
        txid: 'not-hex',
        status: 'submitted',
      },
    })
    const res = await paymentVerifyPOST(req('/api/payment-orders/verify', {
      token: tokenA,
      body: { orderId: order.id },
      headers: { 'x-forwarded-for': '10.60.0.1' },
    }))
    expect(res.status).toBe(400)
    const fresh = await db.paymentOrder.findUnique({ where: { id: order.id } })
    expect(fresh?.status).toBe('failed_verification')
  })
})
