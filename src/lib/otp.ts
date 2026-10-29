import { randomInt, createHmac, timingSafeEqual } from 'crypto'
import { config } from './config'

export const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
export const MAX_OTP_ATTEMPTS = 5 // wrong guesses allowed before the OTP is dead
export const MAX_OTP_REQUESTS_PER_DAY = 3 // per user, not per IP — see forgot-password route

/** Cryptographically random 6-digit code, e.g. "042917". Never predictable. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Hash an OTP for storage. Bound to the userId so a hash can never be
 * replayed against a different user's record even in a contrived scenario.
 * Uses the app's SESSION_SECRET as the HMAC key — this is a server-side
 * secret never exposed to clients, same trust boundary as session tokens.
 */
export function hashOtp(otp: string, userId: string): string {
  return createHmac('sha256', config.sessionSecret).update(`otp:${userId}:${otp}`).digest('hex')
}

/** Timing-safe comparison — prevents timing side-channel attacks on the hash check. */
export function verifyOtpHash(otp: string, userId: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOtp(otp, userId))
  const stored = Buffer.from(storedHash)
  if (candidate.length !== stored.length) return false
  return timingSafeEqual(candidate, stored)
}
