// ─── In-Memory Rate Limiter ────────────────────────────────────────
// Simple per-IP rate limiting for sensitive endpoints (login, register,
// payment verify, OAuth). Suitable for single-instance deployments
// (Coolify VPS). For multi-instance, replace with Redis-backed limiter.
//
// Strategy: sliding window — keeps a rolling list of timestamps per key
// and rejects if too many requests fall within the window.

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup of stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    // Remove entries with no recent activity
    const recent = entry.timestamps.filter((t) => now - t < 60 * 60 * 1000)
    if (recent.length === 0) {
      store.delete(key)
    } else {
      entry.timestamps = recent
    }
  }
}, 5 * 60 * 1000).unref?.()

export interface RateLimitResult {
  success: boolean
  remaining: number
  retryAfterMs: number
}

/**
 * Check rate limit for a given key.
 * @param key - Unique identifier (e.g. `login:${ip}` or `register:${ip}`)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { success, remaining, retryAfterMs }
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key) || { timestamps: [] }

  // Filter out timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= maxRequests) {
    // Calculate when the oldest request will fall out of the window
    const oldest = entry.timestamps[0]
    const retryAfterMs = oldest + windowMs - now
    store.set(key, entry)
    return { success: false, remaining: 0, retryAfterMs: Math.max(1000, retryAfterMs) }
  }

  entry.timestamps.push(now)
  store.set(key, entry)

  return { success: true, remaining: maxRequests - entry.timestamps.length, retryAfterMs: 0 }
}

/**
 * Extract client IP from a Next.js request, accounting for reverse proxies
 * (Coolify/Traefik set X-Forwarded-For).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // A client can send its own X-Forwarded-For; each trusted proxy APPENDS the address it
    // saw. So the first entry is attacker-controlled (it let anyone dodge the rate limits
    // by rotating a fake IP). Count from the RIGHT: with N trusted proxies in front of the
    // app (Coolify/Traefik = 1; Cloudflare + Traefik = 2) the real client is N entries from
    // the end. Set TRUSTED_PROXY_COUNT accordingly.
    const hops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_COUNT || '1', 10) || 1)
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[Math.max(0, parts.length - hops)]
  }
  const xreal = req.headers.get('x-real-ip')
  if (xreal) return xreal.trim()
  return 'unknown'
}
