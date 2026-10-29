import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { destroySession, getSession } from '@/lib/auth'

export async function POST(req: NextRequest) {
  // Signed session tokens are stateless, so deleting the cookie alone left a copied
  // token (header auth / localStorage) valid for its remaining ~7 days. Stamp the user
  // so every token issued before now is rejected by requireAuth(). Note: this signs the
  // user out on all their devices.
  try {
    const session = await getSession(req)
    if (session) {
      await db.user.update({ where: { id: session.userId }, data: { sessionsValidFrom: new Date() } })
    }
  } catch {
    // Never block logout on a DB hiccup — the cookie is still cleared below.
  }
  await destroySession()
  return NextResponse.json({ success: true })
}
