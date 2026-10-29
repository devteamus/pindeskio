import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { runBulkImport } from '@/lib/bulk-import'
import { parseGoogleSheetUrl, fetchSheetAsCsv, SheetUrlError } from '@/lib/google-sheet'

// Google Sheet URL import — same pipeline as the CSV upload
// (src/lib/bulk-import.ts), same per-user throttle key, same plan limits.
// The URL handling itself lives in src/lib/google-sheet.ts (SSRF-safe:
// we never fetch the user's URL — we extract a validated spreadsheet ID
// and build Google's CSV export URL ourselves).
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { sheetUrl?: string; connectionId?: string; importMode?: string; intervalSeconds?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const sheetUrl = typeof body.sheetUrl === 'string' ? body.sheetUrl : ''
  const connectionId = typeof body.connectionId === 'string' ? body.connectionId : ''
  const importMode = body.importMode || 'auto_pacing'
  const intervalSeconds = Number(body.intervalSeconds ?? 60)

  if (!sheetUrl || !connectionId) {
    return NextResponse.json({ error: 'sheetUrl and connectionId are required.' }, { status: 400 })
  }

  // Fail fast: verify the caller owns the connection BEFORE spending an
  // outbound fetch to Google on their behalf. (The shared pipeline re-checks
  // ownership anyway — this is the cheap early exit, not the security
  // boundary.)
  const ownConn = await db.pinterestConnection.findFirst({
    where: { id: connectionId, userId: auth.session.userId },
  })
  if (!ownConn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  // Validate + fetch the sheet as CSV text (throws SheetUrlError with a
  // user-friendly message on every failure mode — never leaks internals).
  let spreadsheetId: string
  let gid: string | null
  let csvText: string
  try {
    const parsed = parseGoogleSheetUrl(sheetUrl)
    spreadsheetId = parsed.spreadsheetId
    gid = parsed.gid
    const fetched = await fetchSheetAsCsv(spreadsheetId, gid)
    csvText = fetched.csvText
  } catch (err) {
    if (err instanceof SheetUrlError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[google-sheet] Unexpected import failure:', err)
    return NextResponse.json({ error: 'Could not import that Google Sheet. Download it as CSV and upload the file instead.' }, { status: 500 })
  }

  // A readable, stable label for the import history (the originalFileName
  // column is what the dashboard's Recent Imports list shows).
  const fileName = `Google Sheet (${spreadsheetId.slice(0, 10)}${gid ? `, tab gid ${gid}` : ''})`

  return runBulkImport({
    user: auth.user,
    userId: auth.session.userId,
    csvText,
    fileName,
    connectionId,
    importMode,
    intervalSeconds,
  })
}
