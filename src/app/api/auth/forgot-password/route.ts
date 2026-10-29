import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findUserByEmail } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { generateOtp, hashOtp, OTP_TTL_MS, MAX_OTP_REQUESTS_PER_DAY } from '@/lib/otp'
import { sendPasswordResetOtpEmail } from '@/lib/email'

// Generic response used whenever we do NOT want to reveal whether an email
// exists in the system. Always the same shape/message.
const GENERIC_SENT_MESSAGE =
  'If that email is registered, a password reset code has been sent to it.'

export async function POST(req: NextRequest) {
  // Defense-in-depth IP rate limit, in ADDITION to the per-user daily limit
  // below (which is the real limit — this just stops one IP from hammering
  // many different emails).
  const ip = getClientIp(req)
  const rl = checkRateLimit(`forgot-password:${ip}`, 8, 60 * 1000)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await findUserByEmail(email)

    // Don't reveal whether the email exists — always look the same from the
    // outside for a non-existent account.
    if (!user || !user.passwordHash) {
      return NextResponse.json({ message: GENERIC_SENT_MESSAGE })
    }

    // ── Per-USER daily limit (the real limit the user asked for: 3/day) ──
    // Counting DB rows rather than an in-memory counter means this survives
    // app restarts and is correct even with multiple app/worker instances.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const requestsToday = await db.passwordResetOtp.count({
      where: { userId: user.id, createdAt: { gte: oneDayAgo } },
    })
    if (requestsToday >= MAX_OTP_REQUESTS_PER_DAY) {
      // Same response as an unknown email — a distinct 429 here would reveal which emails have
      // accounts. No new code is sent.
      return NextResponse.json({ message: GENERIC_SENT_MESSAGE })
    }

    // Invalidate any still-valid previous OTP(s) — only the newest code
    // should ever work, shrinking the window an attacker could exploit an
    // older leaked/guessed code.
    await db.passwordResetOtp.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })

    const otp = generateOtp()
    await db.passwordResetOtp.create({
      data: {
        userId: user.id,
        otpHash: hashOtp(otp, user.id),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        requestIp: ip,
      },
    })

    const emailResult = await sendPasswordResetOtpEmail(user.email, otp, user.name)
    if (!emailResult.success) {
      // Don't leak internal email-provider errors to the client.
      console.error(`[forgot-password] Failed to send OTP email to ${user.email}: ${emailResult.error}`)
      return NextResponse.json({ error: 'Could not send the reset email right now. Please try again shortly.' }, { status: 502 })
    }

    // (no per-account counters in the response: they would only ever appear for real accounts)
    return NextResponse.json({ message: GENERIC_SENT_MESSAGE })
  } catch (e: any) {
    console.error('[forgot-password] Error:', e.message)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
