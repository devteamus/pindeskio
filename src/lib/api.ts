const SESSION_KEY = 'pinscheduler_session' // display-only cache of the user's own profile
const TOKEN_KEY = 'pinscheduler_token' // opaque, server-signed session token used for header auth

export interface SessionData {
  userId: string
  email: string
  name: string | null
  role: string
  status: string
  currentPlanId: string | null
}

/**
 * Cache the session for display purposes AND store the server-issued signed
 * token used to authenticate requests. `session` is never itself trusted by
 * the server — only `token` (an HMAC-signed, expiring blob it issued) is.
 * Editing `session` in devtools only breaks the local UI's own view; it
 * cannot grant access to another account.
 */
export function saveSession(session: SessionData, token?: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  if (token) localStorage.setItem(TOKEN_KEY, token)
}

export function loadSession(): SessionData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionData
  } catch {
    return null
  }
}

function loadToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function clearSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * Authenticated fetch wrapper.
 * Sends the signed session token (opaque to the client) as x-session-token
 * header for environments where cookies don't travel (iframes/webviews).
 * Falls back to cookie-based auth (same-origin) otherwise.
 */
export function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = loadToken()
  const headers = new Headers(options.headers)

  if (token && !headers.has('x-session-token')) {
    headers.set('x-session-token', token)
  }

  // Ensure Content-Type for JSON bodies
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  // Never let the browser HTTP-cache GET requests — dashboard data
  // (usage counters, plan info, pin status) must always be fresh from the DB.
  const fetchOptions: RequestInit = { ...options, headers }
  if (!options.method || options.method === 'GET') {
    fetchOptions.cache = 'no-store'
  }

  return fetch(url, fetchOptions)
}
