// ─── Pinterest OAuth & API Utility ─────────────────────────────────
// All real Pinterest API interactions: OAuth, token management, boards, pins.

import { config } from './config'

const PINTEREST_AUTH_BASE = 'https://www.pinterest.com/oauth'
// Token endpoint is derived from the API base so the whole Pinterest surface
// follows one config (prod default: https://api.pinterest.com/v5/oauth/token).
const tokenUrl = () => `${config.pinterestApiBase}/oauth/token`

// OAuth scopes required for PinDesk
export const PINTEREST_SCOPES = [
  'boards:read',
  'boards:write',
  'pins:read',
  'pins:write',
  'user_accounts:read',
].join(',')

// ─── OAuth URL Generation ──────────────────────────────────────────

/**
 * Generate the Pinterest OAuth authorize URL.
 * @param state - CSRF state token (stored in cookie for verification)
 * @param redirectUri - Override redirect URI (defaults to config)
 */
export function getAuthorizeUrl(state: string, redirectUri?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.pinterestAppId,
    redirect_uri: redirectUri || config.pinterestRedirectUri,
    scope: PINTEREST_SCOPES,
    state,
  })
  return `${PINTEREST_AUTH_BASE}/?${params.toString()}`
}

// ─── Token Exchange ────────────────────────────────────────────────

export interface PinterestTokenResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  scope: string
  refresh_token_expires_in?: number
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForToken(code: string): Promise<PinterestTokenResponse> {
  const basicAuth = Buffer.from(`${config.pinterestAppId}:${config.pinterestAppSecret}`).toString('base64')

  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.pinterestRedirectUri,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest token exchange failed (${res.status}): ${err}`)
  }

  return res.json() as Promise<PinterestTokenResponse>
}

// ─── Token Refresh ─────────────────────────────────────────────────

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<PinterestTokenResponse> {
  const basicAuth = Buffer.from(`${config.pinterestAppId}:${config.pinterestAppSecret}`).toString('base64')

  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest token refresh failed (${res.status}): ${err}`)
  }

  return res.json() as Promise<PinterestTokenResponse>
}

// ─── Pinterest User Profile ────────────────────────────────────────

export interface PinterestUser {
  id: string
  username: string
  display_name: string
  profile_image: string
  account_type: string
  website_url: string | null
  bio: string | null
}

/**
 * Get the authenticated user's Pinterest profile.
 */
export async function getPinterestUser(accessToken: string): Promise<PinterestUser> {
  const res = await fetch(`${config.pinterestApiBase}/user_account`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest user fetch failed (${res.status}): ${err}`)
  }

  return res.json() as Promise<PinterestUser>
}

// ─── Pinterest Boards ──────────────────────────────────────────────

export interface PinterestBoardApi {
  id: string
  name: string
  description: string | null
  privacy: string
  board_owner: {
    id: string
    username: string
  }
  // Pinterest v5 GET /v5/boards returns the live pin count as `pin_count`.
  // (`board_pin_count` is kept as a defensive fallback for older/alternative
  // response shapes — the sync used to read ONLY that name, which silently
  // saved pinCount=0 for every board and broke the Boards-with-Pins stats.)
  pin_count?: number
  board_pin_count?: number
  media_source?: unknown
  created_at: string
}

/** Live pin count on a board — accepts both known field names. */
export function boardPinCount(board: PinterestBoardApi): number {
  return board.pin_count ?? board.board_pin_count ?? 0
}

/**
 * Fetch all boards for the authenticated user.
 * Handles pagination automatically.
 */
export async function fetchPinterestBoards(accessToken: string): Promise<PinterestBoardApi[]> {
  const allBoards: PinterestBoardApi[] = []
  let bookmark: string | null = null
  const batchSize = 100

  do {
    const url = new URL(`${config.pinterestApiBase}/boards`)
    url.searchParams.set('page_size', String(batchSize))
    if (bookmark) url.searchParams.set('bookmark', bookmark)

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Pinterest boards fetch failed (${res.status}): ${err}`)
    }

    const data = await res.json() as { items?: PinterestBoardApi[]; bookmark?: string }
    allBoards.push(...(data.items || []))
    bookmark = data.bookmark || null
  } while (bookmark)

  return allBoards
}

/**
 * Create a board on Pinterest using the real API.
 * POST /v5/boards — requires the boards:write scope.
 */
export async function createPinterestBoard(
  accessToken: string,
  payload: { name: string; description?: string; privacy?: 'PUBLIC' | 'SECRET' },
): Promise<PinterestBoardApi> {
  const res = await fetch(`${config.pinterestApiBase}/boards`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: payload.name,
      ...(payload.description ? { description: payload.description } : {}),
      privacy: payload.privacy || 'PUBLIC',
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest board creation failed (${res.status}): ${err}`)
  }

  return res.json() as Promise<PinterestBoardApi>
}

// ─── Publish Pin (real API call) ───────────────────────────────────

export interface PinterestPinResponse {
  id: string
  title: string | null
  description: string | null
  link: string | null
  board_id: string
  media_source: unknown
  status: string
  created_at: string
}

/**
 * Create a pin on Pinterest using the real API.
 */
export async function createPinterestPin(accessToken: string, payload: Record<string, unknown>): Promise<PinterestPinResponse> {
  const res = await fetch(`${config.pinterestApiBase}/pins`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest pin creation failed (${res.status}): ${err}`)
  }

  return res.json() as Promise<PinterestPinResponse>
}

// ─── Token Expiry Helpers ──────────────────────────────────────────

/**
 * Check if a token is expired or about to expire (within 5 minutes).
 */
export function isTokenExpired(expiresAt: Date | null | string): boolean {
  if (!expiresAt) return true
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  // Consider token expired if less than 5 minutes remaining
  return Date.now() >= expiry.getTime() - 5 * 60 * 1000
}

/**
 * Check if refresh token is expired.
 */
export function isRefreshTokenExpired(expiresAt: Date | null | string): boolean {
  if (!expiresAt) return true
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return Date.now() >= expiry.getTime()
}

/**
 * Get a valid access token — refresh if needed, throw if reauth required.
 * Returns { accessToken, connectionId } with updated token if refreshed.
 */
export async function getValidAccessToken(
  connection: {
    id: string
    accessToken: string | null
    refreshToken: string | null
    tokenExpiresAt: Date | null
    refreshTokenExpiresAt: Date | null
  },
  updateTokensFn: (connectionId: string, data: {
    accessToken: string
    refreshToken?: string
    tokenExpiresAt: Date
    refreshTokenExpiresAt?: Date
  }) => Promise<void>
): Promise<string> {
  // If access token is still valid, return it
  if (connection.accessToken && !isTokenExpired(connection.tokenExpiresAt)) {
    return connection.accessToken
  }

  // Access token expired — try refresh
  if (!connection.refreshToken || isRefreshTokenExpired(connection.refreshTokenExpiresAt)) {
    throw new Error('REAUTH_REQUIRED')
  }

  try {
    const tokenData = await refreshAccessToken(connection.refreshToken)
    const now = new Date()
    const tokenExpiresAt = new Date(now.getTime() + tokenData.expires_in * 1000)
    const refreshTokenExpiresAt = tokenData.refresh_token_expires_in
      ? new Date(now.getTime() + tokenData.refresh_token_expires_in * 1000)
      : undefined

    await updateTokensFn(connection.id, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || connection.refreshToken || undefined,
      tokenExpiresAt,
      refreshTokenExpiresAt,
    })

    return tokenData.access_token
  } catch (err: any) {
    if (err.message?.includes('invalid_grant') || err.message?.includes('refresh_token')) {
      throw new Error('REAUTH_REQUIRED')
    }
    throw err
  }
}
