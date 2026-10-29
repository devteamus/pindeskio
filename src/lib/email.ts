import { config } from './config'

/**
 * Send an email via Resend's HTTP API (https://resend.com).
 * No SDK dependency needed — this is a single fetch call.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
  if (!config.resendApiKey) {
    console.error('[email] RESEND_API_KEY not set — cannot send email')
    return { success: false, error: 'Email service not configured' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [to],
        subject,
        html,
      }),
      // Bounded wait — a hung Resend connection used to hold the whole
      // forgot-password request open (Node's default fetch timeout is 5 min).
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[email] Resend API error (${res.status}):`, err)
      return { success: false, error: 'Failed to send email' }
    }

    return { success: true }
  } catch (err: any) {
    console.error('[email] Failed to send:', err.message)
    return { success: false, error: 'Failed to send email' }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export async function sendPasswordResetOtpEmail(to: string, otp: string, name: string | null): Promise<{ success: boolean; error?: string }> {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,'
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #111827; margin-bottom: 4px;">Pin Desk — Password Reset</h2>
      <p style="color: #374151; font-size: 14px;">${greeting}</p>
      <p style="color: #374151; font-size: 14px;">
        Use the code below to reset your Pin Desk password. This code expires in
        <strong>10 minutes</strong>.
      </p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px;">
        If you didn't request this, you can safely ignore this email — your password
        will not be changed. Never share this code with anyone, including anyone
        claiming to be Pin Desk support.
      </p>
    </div>
  `
  return sendEmail(to, 'Your Pin Desk password reset code', html)
}
