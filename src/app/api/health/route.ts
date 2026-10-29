import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'pin-desk', timestamp: new Date().toISOString() })
}
