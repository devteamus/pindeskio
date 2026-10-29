// ─── Centralized App Configuration (all from env) ────────────────────
// NEVER hardcode secrets here. Everything comes from environment variables.

export const config = {
  // Database (PostgreSQL)
  get databaseUrl() {
    return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pindesk'
  },

  // Redis (job queue + per-connection publish locks)
  get redisUrl() {
    return process.env.REDIS_URL || 'redis://localhost:6379'
  },

  // How many pins the worker will publish in parallel across ALL users/
  // connections at once. Actual per-account pace is still governed by the
  // per-connection lock in the worker, not by this number.
  get workerConcurrency() {
    return parseInt(process.env.WORKER_CONCURRENCY || '25', 10)
  },

  // Session
  get sessionSecret() {
    const s = process.env.SESSION_SECRET
    if (!s) throw new Error('SESSION_SECRET env var is required')
    // A short secret makes the HMAC-signed sessions and OTP hashes brute-forceable offline.
    // (warn, don't throw: rotating the secret signs every user out, so that is the operator's call)
    if (process.env.NODE_ENV === 'production' && s.length < 32 && !(globalThis as any).__warnedShortSecret) {
      ;(globalThis as any).__warnedShortSecret = true
      console.warn('[config] SESSION_SECRET is shorter than 32 characters — use `openssl rand -hex 32` and rotate it')
    }
    return s
  },

  // Pinterest OAuth
  get pinterestAppId() {
    return process.env.PINTEREST_APP_ID || ''
  },
  get pinterestAppSecret() {
    return process.env.PINTEREST_APP_SECRET || ''
  },
  get pinterestApiBase() {
    return process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5'
  },
  get pinterestRedirectUri() {
    return process.env.PINTEREST_REDIRECT_URI || ''
  },

  // Public app URL — used to build absolute redirect URLs (e.g. after
  // OAuth callback) when running behind a reverse proxy (Coolify/Traefik),
  // where the request's own origin resolves to an internal address like
  // 0.0.0.0:3000 or the container's service name instead of the public
  // domain. Set APP_URL explicitly, or it falls back to the origin of
  // PINTEREST_REDIRECT_URI (which must already be the public domain for
  // Pinterest OAuth to work at all).
  get appUrl() {
    const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
    if (explicit) return explicit.replace(/\/+$/, '')
    if (this.pinterestRedirectUri) {
      try {
        return new URL(this.pinterestRedirectUri).origin
      } catch {
        // fall through
      }
    }
    return ''
  },

  // Payment — TRC20 USDT
  get tronWalletAddress() {
    const addr = process.env.TRON_WALLET_ADDRESS || ''
    if (!addr) console.warn('[config] TRON_WALLET_ADDRESS not set — TRC20 payments disabled')
    return addr
  },
  get tronscanApiKey() {
    return process.env.TRONSCAN_API_KEY || ''
  },

  // Payment — Binance Pay
  get binancePayId() {
    const id = process.env.BINANCE_PAY_ID || ''
    if (!id) console.warn('[config] BINANCE_PAY_ID not set — Binance Pay disabled')
    return id
  },

  // Admin (for seed script)
  get adminEmail() {
    return process.env.ADMIN_EMAIL || ''
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || ''
  },

  // Basic Auth (optional site protection)
  get basicAuthUser() {
    return process.env.BASIC_AUTH_USER || ''
  },
  get basicAuthPass() {
    return process.env.BASIC_AUTH_PASS || ''
  },
  get isBasicAuthEnabled() {
    return !!(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS)
  },

  // Email (Resend) — used for password-reset OTP emails
  get resendApiKey() {
    return process.env.RESEND_API_KEY || ''
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || 'Pin Desk <noreply@pindesk.xyz>'
  },

  // App
  get isProduction() {
    return process.env.NODE_ENV === 'production'
  },
  get port() {
    return parseInt(process.env.PORT || '3000', 10)
  },
} as const
