import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { config } from '@/lib/config'
import {
  exchangeCodeForToken,
  getPinterestUser,
  fetchPinterestBoards,
} from '@/lib/pinterest'
import { recordApiCall } from '@/lib/pin-analytics'
import { getSession } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // User denied access
  if (error) {
    return redirectWithMessage(req, 'access_denied', `Pinterest authorization denied: ${error}`)
  }

  if (!code || !state) {
    return redirectWithMessage(req, 'invalid_callback', 'Missing code or state parameter')
  }

  // Verify CSRF state
  const cookieStore = await cookies()
  const storedState = cookieStore.get('pinterest_oauth_state')?.value
  const userId = cookieStore.get('pinterest_oauth_user')?.value

  // Clear OAuth cookies immediately
  cookieStore.delete('pinterest_oauth_state')
  cookieStore.delete('pinterest_oauth_user')

  if (!storedState || storedState !== state) {
    return redirectWithMessage(req, 'invalid_state', 'Invalid OAuth state. Please try again.')
  }

  if (!userId) {
    return redirectWithMessage(req, 'no_user', 'Session expired. Please log in and try again.')
  }

  // SECURITY: `pinterest_oauth_user` is a plain, unsigned cookie — anyone can set it in their own
  // browser. Without this check, a crafted callback could attach a Pinterest account to ANOTHER
  // user's Pin Desk account (userId taken from the cookie, no session check at all). Require the
  // logged-in session to be the same user that started the flow.
  const session = await getSession(req)
  if (!session || session.userId !== userId) {
    return redirectWithMessage(req, 'no_user', 'Session expired or mismatched. Please log in and try again.')
  }

  if (!config.pinterestAppId || !config.pinterestAppSecret) {
    return redirectWithMessage(req, 'not_configured', 'Pinterest OAuth is not configured on the server.')
  }

  try {
    // 1. Exchange code for tokens
    const tokenData = await exchangeCodeForToken(code)
    recordApiCall(userId, 'oauth/token')

    // 2. Fetch user profile from Pinterest
    let profileName: string | null = null
    let profileImageUrl: string | null = null
    let pinterestAccountId: string | null = null

    try {
      const user = await getPinterestUser(tokenData.access_token)
      recordApiCall(userId, 'user_account')
      profileName = user.display_name || user.username
      profileImageUrl = user.profile_image || null
      pinterestAccountId = user.id
    } catch (err: any) {
      console.error('[pinterest/callback] Failed to fetch user profile:', err.message)
      // Non-fatal — we have the tokens, just no profile info
    }

    // 3. Calculate expiry dates
    const now = new Date()
    const tokenExpiresAt = new Date(now.getTime() + tokenData.expires_in * 1000)
    const refreshTokenExpiresAt = tokenData.refresh_token_expires_in
      ? new Date(now.getTime() + tokenData.refresh_token_expires_in * 1000)
      : null

    // 4. Check plan limit — concurrent/active slots only. A disconnected
    // (soft-deleted) account doesn't take up an active slot.
    const userData = await db.user.findUnique({ where: { id: userId } })
    const plan = userData?.currentPlanId
      ? await db.plan.findUnique({ where: { id: userData.currentPlanId } })
      : await db.plan.findUnique({ where: { id: 'plan_free' } })
    const activeCount = await db.pinterestConnection.count({
      where: { userId, status: { not: 'disconnected' } },
    })
    if (plan && activeCount >= plan.maxConnectedAccounts) {
      return redirectWithMessage(req, 'limit_reached', `Plan limit: max ${plan.maxConnectedAccounts} accounts`)
    }

    // 5. Check if this Pinterest account is already connected (by pinterestAccountId).
    // Deliberately NOT filtered by status — this must also find a previously
    // DISCONNECTED row for the same real Pinterest account, so reconnecting
    // it reuses that row (preserving publish history) instead of creating a
    // fresh one.
    let connection = pinterestAccountId
      ? await db.pinterestConnection.findFirst({
          where: { userId, pinterestAccountId },
          include: { boards: true },
        })
      : null

    // 5b. Lifetime distinct-account check — only applies when this is a
    // BRAND NEW Pinterest account for this user (no existing row found
    // above). Reconnecting an account the user has connected before is
    // always allowed and free, since it reuses its existing row rather than
    // consuming a new lifetime slot. This is what stops the "disconnect an
    // old account, connect a totally different one, repeat" loophole — the
    // user can always get their old accounts back, just not swap in
    // unlimited new ones beyond their plan's account count.
    if (!connection && pinterestAccountId) {
      const lifetimeCount = await db.pinterestConnection.count({ where: { userId } })
      if (plan && lifetimeCount >= plan.maxConnectedAccounts) {
        return redirectWithMessage(
          req,
          'lifetime_limit_reached',
          `You've used all ${plan.maxConnectedAccounts} account slots on your plan. Reconnect a previously used Pinterest account, or upgrade your plan to add a new one.`
        )
      }
    }

    if (connection) {
      // Update existing connection with fresh tokens
      connection = await db.pinterestConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || connection.refreshToken,
          tokenExpiresAt,
          refreshTokenExpiresAt,
          scopes: JSON.stringify(tokenData.scope?.split(',') || []),
          status: 'active',
          disconnectedAt: null,
          profileName: profileName || connection.profileName,
          profileImageUrl: profileImageUrl || connection.profileImageUrl,
          lastSyncedAt: new Date(),
        },
        include: { boards: true },
      })
    } else {
      // Create new connection
      connection = await db.pinterestConnection.create({
        data: {
          userId,
          pinterestAccountId,
          profileName: profileName || 'Pinterest User',
          profileImageUrl,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          tokenExpiresAt,
          refreshTokenExpiresAt,
          scopes: JSON.stringify(tokenData.scope?.split(',') || []),
          status: 'active',
        },
        include: { boards: true },
      })
    }

    // 6. Fetch and sync boards from Pinterest
    try {
      const boards = await fetchPinterestBoards(tokenData.access_token)
      recordApiCall(userId, 'boards', connection.id)

      // Deactivate old boards that no longer exist on Pinterest
      const remoteBoardIds = new Set(boards.map((b) => b.id))
      if (remoteBoardIds.size > 0) {
        await db.pinterestBoard.updateMany({
          where: {
            connectionId: connection.id,
            pinterestBoardId: { notIn: Array.from(remoteBoardIds) },
          },
          data: { isActive: false },
        })
      }

      // Upsert boards (find existing by connectionId + pinterestBoardId, then create or update)
      for (const board of boards) {
        const existing = await db.pinterestBoard.findFirst({
          where: { connectionId: connection.id, pinterestBoardId: board.id },
        })
        if (existing) {
          await db.pinterestBoard.update({
            where: { id: existing.id },
            data: {
              boardName: board.name,
              boardDescription: board.description,
              isActive: true,
              syncedAt: new Date(),
            },
          })
        } else {
          await db.pinterestBoard.create({
            data: {
              connectionId: connection.id,
              pinterestBoardId: board.id,
              boardName: board.name,
              boardDescription: board.description,
              boardSectionSupported: false,
              isActive: true,
              syncedAt: new Date(),
            },
          })
        }
      }

      await db.pinterestConnection.update({
        where: { id: connection.id },
        data: { lastSyncedAt: new Date() },
      })
    } catch (err: any) {
      console.error('[pinterest/callback] Board sync failed:', err.message)
      // Non-fatal — connection is saved, boards can be synced later
    }

    // 7. Redirect to dashboard with success
    return redirectWithMessage(req, 'connected', 'Pinterest account connected successfully!')

  } catch (err: any) {
    // SECURITY: Log full error server-side, return generic message to client
    console.error('[pinterest/callback] OAuth error:', err.message)
    return redirectWithMessage(req, 'oauth_error', 'Pinterest connection failed. Please try again.')
  }
}

/**
 * Redirect to the app's root with a query param message.
 * The frontend reads this and shows a toast.
 *
 * IMPORTANT: `new URL('/')` has no base and throws "Invalid URL" — that
 * was crashing this route with a 500 on every branch, including after a
 * successful token save (DB already had the connection, then this line
 * crashed before the browser could be redirected back to the dashboard).
 *
 * `req.nextUrl.origin` is NOT safe to use here either: behind a reverse
 * proxy (Coolify/Traefik/nginx) the app container sees its own internal
 * address (e.g. https://0.0.0.0:3000) unless the proxy forwards and Next
 * trusts X-Forwarded-Host/Proto — which frequently isn't configured.
 * So we resolve the public origin with this priority:
 *   1. X-Forwarded-Proto + X-Forwarded-Host headers (set by most proxies)
 *   2. config.appUrl (APP_URL env var, or derived from PINTEREST_REDIRECT_URI)
 *   3. req.nextUrl.origin as a last-resort fallback
 */
function getPublicOrigin(req: NextRequest): string {
  // The operator-configured public URL wins: forwarded headers are only as trustworthy as the
  // proxy in front of us, and this value becomes a redirect target.
  if (config.appUrl) {
    return config.appUrl
  }
  const fwdHost = req.headers.get('x-forwarded-host')
  const fwdProto = req.headers.get('x-forwarded-proto')
  if (fwdHost) {
    return `${fwdProto === 'http' ? 'http' : 'https'}://${fwdHost}`
  }
  return req.nextUrl.origin
}

function redirectWithMessage(req: NextRequest, type: string, message: string) {
  const url = new URL('/', getPublicOrigin(req))
  url.searchParams.set('auth_result', type)
  url.searchParams.set('auth_message', encodeURIComponent(message))
  return NextResponse.redirect(url.toString())
}
