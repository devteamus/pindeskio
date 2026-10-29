import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  runBulkImport,
  MAX_CSV_BYTES,
} from '@/lib/bulk-import'

// CSV file upload — the actual import pipeline (parsing, validation, plan
// limits, quota, scheduling, enqueueing) lives in src/lib/bulk-import.ts and
// is shared verbatim with the Google Sheet URL import route
// (/api/pins/bulk/google-sheet). This handler only handles auth, the
// multipart form and the file size cap.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const connectionId = formData.get('connectionId') as string | null
  // The user now picks the exact gap between pins directly (e.g. "30 minutes",
  // "2 hours", "1 day") — the frontend converts whatever unit the user picked
  // into raw seconds before sending; the pipeline only ever deals in seconds.
  const intervalSeconds = parseFloat((formData.get('intervalSeconds') as string) || '60')

  if (!file || typeof file === 'string' || !connectionId) return NextResponse.json({ error: 'File and connectionId required' }, { status: 400 })
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: `CSV file is too large (max ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB). Split it into smaller files.` }, { status: 413 })
  }

  const csvText = await file.text()
  return runBulkImport({
    user: auth.user,
    userId: auth.session.userId,
    csvText,
    fileName: file.name,
    connectionId,
    importMode: (formData.get('importMode') as string) || 'auto_pacing',
    intervalSeconds,
  })
}
