import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { config } from '@/lib/config'
import { randomUUID } from 'crypto'
import { getAuthorizeUrl } from '@/lib/pinterest'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // SECURITY: Use an explicit `select` to NEVER expose OAuth tokens
  // (accessToken, refreshToken, tokenExpiresAt, refreshTokenExpiresAt) to the
  // browser. Previously this used `include` which returned every column.
  const connections = await db.pinterestConnection.findMany({
    // Soft-deleted (disconnected) accounts stay in the DB for history/limit
    // tracking but should never show up in the account list again.
    where: { userId: auth.session.userId, status: { not: 'disconnected' } },
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
      boards: {
        where: { isActive: true },
        select: { id: true, connectionId: true, pinterestBoardId: true, boardName: true, boardDescription: true, isActive: true },
      },
      _count: { select: { scheduledPins: true, importBatches: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ connections })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Check plan limit
  const plan = auth.user.currentPlanId
    ? await db.plan.findUnique({ where: { id: auth.user.currentPlanId } })
    : await db.plan.findUnique({ where: { id: 'plan_free' } })

  // Concurrent-slot check — how many accounts are ACTIVELY connected right now.
  // Disconnected (soft-deleted) accounts don't count against this.
  const activeCount = await db.pinterestConnection.count({
    where: { userId: auth.session.userId, status: { not: 'disconnected' } },
  })
  if (plan && activeCount >= plan.maxConnectedAccounts) {
    return NextResponse.json({ error: `Plan limit reached. Maximum ${plan.maxConnectedAccounts} accounts.` }, { status: 400 })
  }

  // === Real OAuth Flow ===
  if (config.pinterestAppId && config.pinterestRedirectUri) {
    const state = randomUUID()
    const cookieStore = await cookies()
    cookieStore.set('pinterest_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })
    cookieStore.set('pinterest_oauth_user', auth.session.userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })

    const authorizeUrl = getAuthorizeUrl(state)
    return NextResponse.json({ oauth: true, url: authorizeUrl })
  }

  // === Fallback: Simulated Connection (no Pinterest credentials configured) ===
  // SECURITY/CORRECTNESS: a simulated connection makes the worker mark pins as
  // "published" without ever calling Pinterest. In production that would silently
  // lie to paying users if PINTEREST_APP_ID / PINTEREST_REDIRECT_URI go missing
  // (bad redeploy, env typo). Refuse loudly instead. Opt in only for local demos
  // with ALLOW_SIMULATED_PINS=true.
  if (config.isProduction && process.env.ALLOW_SIMULATED_PINS !== 'true') {
    console.error('[connections] Pinterest OAuth is not configured — refusing to create a simulated connection in production')
    return NextResponse.json(
      { error: 'Pinterest connection is temporarily unavailable. Please contact support.' },
      { status: 503 },
    )
  }
  console.warn('[connections] Pinterest OAuth not configured — falling back to simulated connection')

  // Lifetime distinct-account check — simulated connects always mint a brand
  // new fake Pinterest identity (there's no real account to "reconnect" to),
  // so every simulated connect must be checked against the TOTAL number of
  // accounts this user has EVER connected (active + disconnected), not just
  // the currently-active count. Otherwise a user could disconnect an account
  // and add a fresh one indefinitely to dodge the plan's account cap — the
  // exact abuse case this fix closes.
  const lifetimeCount = await db.pinterestConnection.count({ where: { userId: auth.session.userId } })
  if (plan && lifetimeCount >= plan.maxConnectedAccounts) {
    return NextResponse.json({
      error: `You've used all ${plan.maxConnectedAccounts} account slots on your plan. Disconnecting an account frees up a slot to reconnect it later, but doesn't let you add a different new account beyond your plan limit — upgrade your plan to connect more.`,
    }, { status: 400 })
  }

  const { nickname } = await req.json().catch(() => ({}))
  const simulatedId = 'pin_' + Math.random().toString(36).substring(2, 10)

  const connection = await db.pinterestConnection.create({
    data: {
      userId: auth.session.userId,
      pinterestAccountId: simulatedId,
      profileName: nickname || 'Pinterest User (Demo)',
      profileImageUrl: null,
      accessToken: 'simulated_access_token_' + simulatedId,
      refreshToken: 'simulated_refresh_token_' + simulatedId,
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      scopes: JSON.stringify(['boards:read', 'boards:write', 'pins:read', 'pins:write']),
      status: 'active',
      nickname: nickname || null,
    },
    // SECURITY: select only safe fields — never expose accessToken/refreshToken
    select: {
      id: true, userId: true, pinterestAccountId: true, profileName: true,
      profileImageUrl: true, status: true, lastSyncedAt: true, nickname: true,
      createdAt: true, updatedAt: true,
      boards: { select: { id: true, connectionId: true, pinterestBoardId: true, boardName: true, boardDescription: true, isActive: true } },
    },
  })

  // Auto-create demo boards
  const demoBoards = ['My Pins', 'Inspiration', 'Products', 'Blog Posts', 'Ideas']
  await Promise.all(
    demoBoards.map((name) =>
      db.pinterestBoard.create({
        data: {
          connectionId: connection.id,
          pinterestBoardId: 'board_' + Math.random().toString(36).substring(2, 10),
          boardName: name,
          boardDescription: `Demo board: ${name}`,
        },
      })
    )
  )

  await db.pinterestConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date() },
  })

  return NextResponse.json({ oauth: false, connection })
}
