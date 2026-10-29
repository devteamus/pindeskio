import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPasswordAsync, findUserByEmail } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { verifyOtpHash, MAX_OTP_ATTEMPTS } from '@/lib/otp'

// Same generic error for "wrong code", "expired", "too many attempts", and
// "user not found" — no differential that would help an attacker figure out
// which case they hit.
const GENERIC_INVALID_MESSAGE = 'Invalid or expired code. Please request a new one.'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = checkRateLimit(`reset-password:${ip}`, 15, 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  try {
    const { email, otp, newPassword } = await req.json()
    if (!email || !otp || !newPassword) {
      return NextResponse.json({ error: 'Email, code, and new password are required' }, { status: 400 })
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }
    const cleanOtp = String(otp).trim()
    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    const user = await findUserByEmail(String(email))
    if (!user) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    // Most recent OTP for this user that hasn't been consumed yet.
    const record = await db.passwordResetOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    })

    if (!record || record.expiresAt < new Date() || record.attempts >= MAX_OTP_ATTEMPTS) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    // Claim ONE guess atomically BEFORE comparing. The old flow read `attempts`, compared, and
    // only then incremented — so N parallel requests all saw attempts=0 and each got a free
    // guess (far more than MAX_OTP_ATTEMPTS against a 6-digit code). The conditional
    // UPDATE ... WHERE attempts < MAX is a single atomic statement: at most MAX_OTP_ATTEMPTS
    // requests can ever pass it, no matter how they interleave.
    const claimed = await db.passwordResetOtp.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: MAX_OTP_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    const isValid = verifyOtpHash(cleanOtp, user.id, record.otpHash)
    if (!isValid) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    // ── Success: update password, burn this OTP (single use), log it ──
    const newHash = await hashPasswordAsync(newPassword)
    const used = await db.$transaction(async (tx) => {
      // Single-use: only one concurrent correct submission can flip consumedAt from null.
      const burn = await tx.passwordResetOtp.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      if (burn.count === 0) return false
      // sessionsValidFrom: every session issued before the reset (e.g. by whoever knew the
      // old password) is signed out.
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash, sessionsValidFrom: new Date() } })
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'password_reset_via_otp',
          metadataJson: JSON.stringify({ ip }),
        },
      })
      return true
    })
    if (!used) {
      return NextResponse.json({ error: GENERIC_INVALID_MESSAGE }, { status: 400 })
    }

    return NextResponse.json({ message: 'Password reset successfully. You can now log in with your new password.' })
  } catch (e: any) {
    console.error('[reset-password] Error:', e.message)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
