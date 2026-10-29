import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { enqueuePinJobsWithinHorizon } from '@/lib/queue'
import { getSubscriptionState, planExpiredResponseBody } from '@/lib/subscription'
import { checkRateLimit } from '@/lib/rate-limit'

// Chunk size for bulk inserts / queue enqueues. Postgres caps a single
// statement at 65,535 bind parameters — a 15-column insert allows ~4,300
// rows max — so 1,000 keeps us safely under the limit while still turning
// what used to be 100,000 sequential round-trips (a 50k-row CSV) into
// ~150 chunked statements.
const BULK_CHUNK = 1000

// Pinterest v5 API hard limits for POST /v5/pins fields. A 900-char CSV
// description used to reach Pinterest and fail with 400 "…too long
// (constraint: maxLength=800)" AFTER burning retries. We truncate at
// import time so exactly what is stored is what can be published.
// (The worker ALSO truncates as a final safety net for legacy rows.)
const PIN_LIMITS = { title: 100, description: 800, altText: 500 } as const

function truncateField(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function parseCSV(text: string): { rows: Record<string, string>[]; headers: string[]; truncated: boolean } {
  // Strip BOM (Byte Order Mark) — Excel/Google Sheets export adds \uFEFF at the
  // start of UTF-8 CSV files. Without stripping, the first header becomes
  // "\uFEFFtitle" instead of "title", and ALL column lookups fail silently.
  const cleanText = text.replace(/^\uFEFF/, '')

  let truncated = false

  // RFC-4180 parser that walks the WHOLE text. The previous version split the file on newlines
  // first and parsed each line on its own, so any quoted field containing a line break (very
  // common in pin descriptions) was cut in half: the row shifted, columns misaligned and the
  // pin either failed validation or was published with the wrong data.
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  const pushField = () => { record.push(field); field = '' }
  const pushRecord = () => {
    pushField()
    // skip completely empty lines
    if (!(record.length === 1 && !record[0].trim())) {
      if (records.length >= MAX_CSV_RECORDS) {
        // SECURITY: stop materializing — the caller rejects the file below.
        truncated = true
      } else {
        records.push(record)
      }
    }
    record = []
  }

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i]
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') { field += '"'; i++ } // escaped quote ("")
        else inQuotes = false
      } else {
        field += ch // includes \r and \n inside quotes
      }
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { pushField(); continue }
    if (ch === '\r') {
      if (cleanText[i + 1] === '\n') i++
      pushRecord()
      continue
    }
    if (ch === '\n') { pushRecord(); continue }
    field += ch
  }
  // last record without trailing newline
  if (field.length > 0 || record.length > 0) pushRecord()

  if (records.length < 2) return { rows: [], headers: [], truncated }
  const headers = records[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows: Record<string, string>[] = []
  for (let i = 1; i < records.length; i++) {
    const values = records[i]
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim() })
    rows.push(row)
  }
  return { rows, headers, truncated }
}

// Only http(s) URLs may reach Pinterest or be stored/rendered as links — new URL() alone also
// accepts javascript:, data:, file: …
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Hard cap on the uploaded CSV (50k rows × ~500 B ≈ 25 MB). file.text() on an unbounded upload
// would blow the 384 MB heap and take the whole app container down.
const MAX_CSV_BYTES = 30 * 1024 * 1024

// SECURITY (2nd-pass audit): absolute record cap enforced DURING parsing, not after.
// parseCSV used to materialize the ENTIRE file first (a 30 MB file of ",\n"
// rows = ~15 million row objects ≈ >1 GB on a 384 MB heap → any logged-in
// user could OOM the app for everyone). 100k records is above every plan's
// maxRowsPerImport (top plan = 50,000), so no legitimate upload is affected.
const MAX_CSV_RECORDS = 100_000

// Per-user import rate limit (2nd-pass audit): an authenticated user could
// hammer this expensive endpoint (30 MB parse + DB writes) without any
// throttle. 20/hour is far above any realistic legitimate use (the largest
// plan allows 50k rows per import; the worker publishes ~40k pins/hour).
const MAX_IMPORTS_PER_HOUR = 20

// Longest gap accepted between pins (1 year). Also guards against Infinity / 1e309, which made
// `new Date(...)` invalid and the insert crash with a 500.
const MAX_INTERVAL_SECONDS = 365 * 24 * 60 * 60

// Normalize the import mode coming from the dashboard.
// Dashboard sends 'exact' | 'auto'; the DB/worker use 'exact_schedule' | 'auto_pacing'.
function normalizeImportMode(raw: string): 'exact_schedule' | 'auto_pacing' {
  const v = (raw || '').toLowerCase()
  if (v === 'exact' || v === 'exact_schedule') return 'exact_schedule'
  return 'auto_pacing'
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth.error || !auth.session || !auth.user) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Plan expired → no new pins until renewed (existing queued pins resume automatically on renewal)
  const subState = await getSubscriptionState(auth.user)
  if (subState.enforced && !subState.active) {
    return NextResponse.json(planExpiredResponseBody(subState), { status: 403 })
  }

  // SECURITY (2nd-pass audit): per-USER throttle on this expensive endpoint
  // (30 MB parse + bulk DB writes). Keyed by userId, not IP — the upload is
  // authenticated, so this also covers distributed multi-IP abuse.
  const importRl = checkRateLimit(`bulk-import:${auth.session.userId}`, MAX_IMPORTS_PER_HOUR, 60 * 60 * 1000)
  if (!importRl.success) {
    return NextResponse.json(
      { error: `Too many imports. You can run up to ${MAX_IMPORTS_PER_HOUR} imports per hour — please wait a bit.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(importRl.retryAfterMs / 1000)) } },
    )
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const connectionId = formData.get('connectionId') as string | null
  const importMode = normalizeImportMode((formData.get('importMode') as string) || 'auto_pacing')
  // The user now picks the exact gap between pins directly (e.g. "30 minutes",
  // "2 hours", "1 day") instead of the old auto-calculated pacing. The
  // frontend converts whatever unit the user picked into raw seconds before
  // sending — this route only ever deals in seconds.
  let intervalSeconds = parseFloat((formData.get('intervalSeconds') as string) || '60')

  if (!file || typeof file === 'string' || !connectionId) return NextResponse.json({ error: 'File and connectionId required' }, { status: 400 })
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: `CSV file is too large (max ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB). Split it into smaller files.` }, { status: 413 })
  }

  const conn = await db.pinterestConnection.findFirst({ where: { id: connectionId, userId: auth.session.userId } })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  const boards = await db.pinterestBoard.findMany({ where: { connectionId, isActive: true } })

  // Build a robust board lookup map.
  // Keys are normalized: trimmed, lowercased, internal whitespace collapsed.
  // This handles the common case where the CSV board name has trailing spaces
  // or different casing than what Pinterest returned.
  function normalizeBoardName(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ').normalize('NFC')
  }
  const boardMap = new Map<string, typeof boards[number]>()
  for (const b of boards) {
    boardMap.set(normalizeBoardName(b.boardName), b)
    // Also map by pinterestBoardId (in case CSV uses the numeric ID)
    boardMap.set(normalizeBoardName(b.pinterestBoardId), b)
  }
  const boardIdMap = new Map(boards.map((b) => [b.id, b]))
  // Direct id → pinterestBoardId lookup (used per CSV row when building
  // payloadJson). boards.find() inside the 50k-row loop was O(rows × boards)
  // string-id comparisons on the event loop; the Map is O(1) per row.
  const pinterestIdByBoardId = new Map(boards.map((b) => [b.id, b.pinterestBoardId]))

  // Get plan and enforce limits
  const plan = auth.user.currentPlanId
    ? await db.plan.findUnique({ where: { id: auth.user.currentPlanId } })
    : await db.plan.findUnique({ where: { id: 'plan_free' } })

  const dailyPinLimit = plan?.dailyPinLimit || 10 // HARD LIMIT per account per 24h — enforced by the worker at publish time, not here

  // Server-side safety floor: never allow an interval so small it would hammer
  // Pinterest's API regardless of what the client sent (defense in depth —
  // the frontend already clamps this, this just protects against a direct
  // API call bypassing the UI). No upper limit — a user can space pins days
  // or weeks apart if they want.
  const MIN_INTERVAL_SECONDS = 60
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
    intervalSeconds = MIN_INTERVAL_SECONDS
  }
  if (intervalSeconds > MAX_INTERVAL_SECONDS) intervalSeconds = MAX_INTERVAL_SECONDS

  const monthKey = new Date().toISOString().slice(0, 7)
  let counter = await db.usageCounter.findUnique({ where: { userId_monthKey: { userId: auth.session.userId, monthKey } } })
  const usedMonthly = counter?.publishedCount || 0
  const remainingMonthly = (plan?.monthlyPinQuota || 10) - usedMonthly

  const text = await file.text()
  const { rows, headers: csvHeaders, truncated } = parseCSV(text)

  // SECURITY (2nd-pass audit): oversized CSVs are rejected BEFORE any row
  // materialization work continues — bounded memory no matter what is uploaded.
  if (truncated) {
    return NextResponse.json({
      error: `CSV has more than ${MAX_CSV_RECORDS.toLocaleString()} rows — the maximum is ${MAX_CSV_RECORDS.toLocaleString()}. Split the file.`,
      limit: 'maxCsvRecords',
      maxCsvRecords: MAX_CSV_RECORDS,
    }, { status: 400 })
  }

  if (rows.length === 0) {
    return NextResponse.json({
      error: 'CSV file is empty or has no data rows. Make sure your CSV has a header row and at least one data row.',
      detectedHeaders: csvHeaders,
    }, { status: 400 })
  }

  // Diagnostic: check if required columns exist in the CSV.
  // This catches the case where the user's CSV has different header names
  // (e.g. "Board" instead of "board_name") — which would make every row invalid.
  const hasBoardCol = csvHeaders.some((h) =>
    h === 'board' || h === 'board_id' || h === 'board_name' || h === 'boardname'
  )
  const hasTitleCol = csvHeaders.some((h) => h === 'title' || h === 'name')
  const hasImageCol = csvHeaders.some((h) =>
    h === 'image_url' || h === 'image' || h === 'imageurl' || h === 'image url'
  )
  const missingCols: string[] = []
  if (!hasTitleCol) missingCols.push('title')
  if (!hasImageCol) missingCols.push('image_url')
  if (!hasBoardCol) missingCols.push('board_name')
  if (missingCols.length > 0) {
    return NextResponse.json({
      error: `CSV is missing required column(s): ${missingCols.join(', ')}. Detected headers: ${csvHeaders.join(', ')}. Required: title, board_name, image_url`,
      detectedHeaders: csvHeaders,
      missingColumns: missingCols,
    }, { status: 400 })
  }

  if (plan && rows.length > plan.maxRowsPerImport) {
    return NextResponse.json({
      error: `Your CSV has ${rows.length} rows, but your plan allows max ${plan.maxRowsPerImport} rows per import. Upgrade your plan or split your CSV into smaller files.`,
      limit: 'maxRowsPerImport',
      maxRows: plan.maxRowsPerImport,
      actualRows: rows.length,
    }, { status: 400 })
  }

  // Pre-check monthly quota — if remaining is 0, tell the user immediately
  // instead of marking every single row as "Exceeds monthly quota"
  if (remainingMonthly <= 0) {
    return NextResponse.json({
      error: `Your monthly pin quota is exhausted (${usedMonthly}/${plan?.monthlyPinQuota || 10} pins published this month). Upgrade your plan to publish more pins.`,
      limit: 'monthlyQuota',
      used: usedMonthly,
      quota: plan?.monthlyPinQuota || 10,
    }, { status: 400 })
  }

  // Validate rows
  let validRows = 0
  let invalidRows = 0
  const batchRows: {
    imageUrl: string; title: string; description: string; destinationUrl: string
    boardInput: string; publishAt: string | null; altText: string | null; note: string | null
    rowFingerprint: string; validationStatus: string; validationErrors: string
    resolvedBoardId: string | null
    rowNumber: number
  }[] = []

  // Collect per-row error samples to return to the frontend.
  // CAP the stored samples — a 50k-row all-invalid CSV used to materialize
  // 50k error objects in memory only to return the first 50. The response
  // is identical (slice(0, 50) below); the cap just bounds the memory.
  const MAX_ERROR_SAMPLES = 100
  const errorSamples: { row: number; title: string; errors: string[] }[] = []
  // How many text fields were trimmed to fit Pinterest's limits
  let truncatedRows = 0

  // If the connection has no boards at all, fail fast with a helpful message
  // instead of marking every single row as "Board not found".
  if (boards.length === 0) {
    return NextResponse.json({
      error: `This Pinterest account has no synced boards. Go to the Accounts tab and click "Sync" on the connection first, then try the bulk upload again.`,
      availableBoards: [],
    }, { status: 400 })
  }

  // Pre-compute the list of available board names for error messages
  const availableBoardNames = boards.map((b) => b.boardName)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const errors: string[] = []
    const imageUrl = r.image_url || r['image url'] || r.image || ''
    const title = truncateField(r.title || r.name || '', PIN_LIMITS.title)
    const description = truncateField(r.description || r.desc || '', PIN_LIMITS.description)
    const destUrl = r.destination_url || r['destination url'] || r.link || r.url || ''
    // Accept board, board_id, OR board_name (the format the dashboard's CSV reference documents)
    const boardInput = r.board || r.board_id || r.board_name || r['board name'] || ''
    const publishAtRaw = r.publish_at || r['publish at'] || r.schedule_at || r.scheduled_for || null
    // Timezone handling: publish_at values WITH an explicit offset/Z are used
    // as-is (new Date handles the conversion to UTC). NAIVE strings (no offset,
    // e.g. "2026-10-27 15:00") are interpreted as UTC — deterministic no matter
    // what TZ the app container runs in. A date that still parses to NaN is a
    // validation error in exact mode (it used to silently fall back to
    // auto-pacing, hiding the user's mistake).
    let publishAt: Date | null = null
    let publishAtInvalid = false
    if (publishAtRaw) {
      const hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})\s*$/i.test(String(publishAtRaw).trim())
      const parsed = hasExplicitTz
        ? new Date(publishAtRaw)
        : new Date(`${String(publishAtRaw).trim()}Z`)
      if (isNaN(parsed.getTime())) publishAtInvalid = true
      else publishAt = parsed
    }
    const altTextRaw = r.alt_text || r['alt text'] || r.alttext || null
    const altText = altTextRaw ? truncateField(altTextRaw, PIN_LIMITS.altText) : null
    const note = r.note || null

    // Count rows where Pinterest's limits forced a trim (reported back so
    // the user knows the stored text is the truncated version)
    if ((r.title || r.name || '').length > PIN_LIMITS.title) truncatedRows++
    if ((r.description || r.desc || '').length > PIN_LIMITS.description) truncatedRows++
    if (altTextRaw && altTextRaw.length > PIN_LIMITS.altText) truncatedRows++

    if (!imageUrl) errors.push('image_url is required')
    if (!title) errors.push('title is required')
    if (!boardInput) errors.push('board is required')
    // In exact-schedule mode an unparsable publish_at must fail the row —
    // previously it silently fell back to interval pacing and the pin went
    // out at a time the user never chose.
    if (importMode === 'exact_schedule' && publishAtInvalid) {
      errors.push(`Invalid publish_at value "${publishAtRaw}" — use ISO 8601 (e.g. 2026-10-27T15:00:00Z)`) 
    }

    let resolvedBoardId: string | null = null
    // Use the same normalization as the board map (trim, lowercase, collapse spaces, NFC)
    const normalizedBoardInput = normalizeBoardName(boardInput)
    const matchedBoard = boardMap.get(normalizedBoardInput) || boardIdMap.get(boardInput)
    if (matchedBoard) resolvedBoardId = matchedBoard.id
    else if (boardInput) {
      // Try a "contains" fallback: if the CSV board name contains (or is contained in)
      // an available board name, match it. This handles cases like "My Board (2024)"
      // vs "My Board" or Pinterest boards with extra suffixes.
      // Only accept a fuzzy match when it is UNAMBIGUOUS and the two names are of similar
      // length (shorter ≥ 4 chars and ≥ 50% of the longer). Previously the first board whose
      // name merely *contained* the input won, so "Home" silently posted to "Home Decor".
      const candidates: typeof boards = []
      for (const b of boards) {
        const normB = normalizeBoardName(b.boardName)
        const shorter = Math.min(normB.length, normalizedBoardInput.length)
        const longer = Math.max(normB.length, normalizedBoardInput.length)
        if (shorter >= 4 && shorter / longer >= 0.5 && (normB.includes(normalizedBoardInput) || normalizedBoardInput.includes(normB))) {
          candidates.push(b)
        }
      }
      if (candidates.length === 1) {
        resolvedBoardId = candidates[0].id
      } else if (candidates.length > 1) {
        errors.push(`Board "${boardInput}" matches several boards (${candidates.map((c) => c.boardName).join(', ')}). Use the exact board name.`)
      } else {
        // Include the available board names so the user knows what to fix in their CSV
        errors.push(`Board "${boardInput}" not found. Available boards: ${availableBoardNames.join(', ')}`)
      }
    }

    if (imageUrl && !isHttpUrl(imageUrl)) errors.push('Invalid image_url (must start with http:// or https://)')
    if (destUrl && !isHttpUrl(destUrl)) errors.push('Invalid destination_url (must start with http:// or https://)')

    const fingerprint = [title, destUrl, boardInput].join('::').toLowerCase()

    if (errors.length > 0) {
      invalidRows++
      if (errorSamples.length < MAX_ERROR_SAMPLES) {
        errorSamples.push({ row: i + 1, title: title || `(row ${i + 1})`, errors })
      }
    } else {
      validRows++
    }

    batchRows.push({
      imageUrl, title, description, destinationUrl: destUrl, boardInput,
      publishAt: publishAt ? publishAt.toISOString() : null,
      altText, note, rowFingerprint: fingerprint,
      validationStatus: errors.length > 0 ? 'invalid' : 'valid',
      validationErrors: JSON.stringify(errors),
      resolvedBoardId,
      rowNumber: i + 1,
    })
  }

  // Cap valid rows to monthly remaining
  const effectiveValid = Math.min(validRows, remainingMonthly)
  if (validRows > remainingMonthly) {
    let excess = validRows - remainingMonthly // must decrease per row, otherwise EVERY valid row is invalidated
    for (let i = batchRows.length - 1; i >= 0 && excess > 0; i--) {
      if (batchRows[i].validationStatus === 'valid') {
        batchRows[i].validationStatus = 'invalid'
        batchRows[i].validationErrors = JSON.stringify(['Exceeds monthly quota'])
        if (errorSamples.length < MAX_ERROR_SAMPLES) {
          errorSamples.unshift({ row: batchRows[i].rowNumber, title: batchRows[i].title || `(row ${batchRows[i].rowNumber})`, errors: ['Exceeds monthly quota'] })
        }
        invalidRows++
        validRows--
        excess--
      }
    }
  }

  // Create batch
  const batch = await db.importBatch.create({
    data: {
      userId: auth.session.userId,
      connectionId,
      originalFileName: file.name,
      importMode,
      // `dailyTarget` column is kept for display/history purposes only — it's
      // no longer what drives scheduling. Scheduling now comes directly from
      // the user's chosen intervalSeconds (see the loop below).
      dailyTarget: importMode === 'auto_pacing' ? Math.max(1, Math.floor(86400 / intervalSeconds)) : null,
      totalRows: rows.length,
      validRows: effectiveValid,
      invalidRows,
      queuedRows: 0,
      status: 'validated',
    },
  })

  // Create import rows and scheduled pins — BULK PATH.
  // CUSTOM INTERVAL LOGIC:
  // - The user picks one gap (in seconds, converted from minutes/hours/days
  //   on the frontend) to apply between every consecutive pin for this
  //   account, e.g. "1 pin every 30 minutes".
  // - Pin #0 goes out ~now, pin #1 at now+interval, pin #2 at now+2*interval, etc.
  // - This is linear and has NO daily cap baked into the schedule itself —
  //   the account's real daily limit is still enforced by the worker at
  //   publish time (it reschedules any pin that would exceed the plan's
  //   dailyPinLimit to +24h), so a too-fast interval just means some pins
  //   land a day later rather than being silently re-spaced by this route.
  const now = Date.now()
  // Capped at PREVIEW_CAP rows — this array is only for the HTTP response
  // (which slices to 200); building one entry per CSV row was pure garbage
  // at 50k rows of working-set memory on top of an already large import.
  const PREVIEW_CAP = 200
  const previewRows: {
    rowNumber: number
    title: string
    board: string
    imageUrl: string
    scheduledFor: string | null
    status: string
    errors: string[]
  }[] = []

  // ── Step 1: bulk-insert ALL import rows (valid + invalid) ──
  // createMany is a single multi-row INSERT per chunk instead of one
  // round-trip per row — a 50k-row CSV used to take minutes here.
  const importRowData = batchRows.map((r, i) => ({
    batchId: batch.id,
    rowNumber: i + 1,
    imageUrl: r.imageUrl || null,
    title: r.title || null,
    description: r.description || null,
    destinationUrl: r.destinationUrl || null,
    boardInput: r.boardInput || null,
    resolvedBoardId: r.validationStatus === 'valid' ? r.resolvedBoardId : null,
    publishAt: r.publishAt ? new Date(r.publishAt) : null,
    altText: r.altText,
    note: r.note,
    rowFingerprint: r.rowFingerprint,
    validationStatus: r.validationStatus,
    validationErrors: r.validationErrors,
  }))
  for (let i = 0; i < importRowData.length; i += BULK_CHUNK) {
    await db.importRow.createMany({ data: importRowData.slice(i, i + BULK_CHUNK) })
  }

  // ── Step 2: map rowNumber → inserted id (createMany can't return ids) ──
  const insertedRows = await db.importRow.findMany({
    where: { batchId: batch.id },
    select: { id: true, rowNumber: true },
  })
  const rowIdByNumber = new Map(insertedRows.map((r) => [r.rowNumber, r.id]))

  // ── Step 3: build + bulk-insert scheduled pins for VALID rows ──
  let queueIndex = 0
  const pinData: {
    userId: string
    connectionId: string
    batchId: string
    importRowId: string | null
    boardId: string | null
    title: string
    description: string | null
    destinationUrl: string | null
    imageUrl: string
    altText: string | null
    scheduledFor: Date
    status: string
    payloadJson: string
  }[] = []

  for (let i = 0; i < batchRows.length; i++) {
    const r = batchRows[i]

    let scheduledFor: Date | null = null

    if (r.validationStatus === 'valid') {
      if (importMode === 'exact_schedule' && r.publishAt) {
        scheduledFor = new Date(r.publishAt)
      } else {
        // CUSTOM INTERVAL: pin #0 ~now, pin #1 at now+interval, pin #2 at
        // now+2*interval, ... — exactly the gap the user chose, no
        // day-bucketing or rounding.
        scheduledFor = new Date(now + queueIndex * intervalSeconds * 1000)
      }

      pinData.push({
        userId: auth.session.userId,
        connectionId,
        batchId: batch.id,
        importRowId: rowIdByNumber.get(i + 1) ?? null,
        boardId: r.resolvedBoardId || null,
        title: r.title,
        description: r.description || null,
        destinationUrl: r.destinationUrl || null,
        imageUrl: r.imageUrl,
        altText: r.altText,
        scheduledFor,
        status: 'queued',
        payloadJson: JSON.stringify({
          title: r.title,
          description: r.description,
          link: r.destinationUrl,
          board_id: pinterestIdByBoardId.get(r.resolvedBoardId || '') || undefined,
          media_source: { source_type: 'image_url', url: r.imageUrl },
        }),
      })
      queueIndex++
    }

    if (previewRows.length < PREVIEW_CAP) {
      previewRows.push({
        rowNumber: r.rowNumber,
        title: r.title || '(empty)',
        board: r.boardInput || '-',
        imageUrl: r.imageUrl || '',
        scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
        status: r.validationStatus,
        errors: r.validationStatus === 'invalid' ? JSON.parse(r.validationErrors) : [],
      })
    }
  }

  for (let i = 0; i < pinData.length; i += BULK_CHUNK) {
    await db.scheduledPin.createMany({ data: pinData.slice(i, i + BULK_CHUNK) })
  }

  // ── Step 4: bulk-enqueue BullMQ jobs — 48-HOUR HORIZON ONLY ──
  // PostgreSQL keeps ALL future pins; Redis only gets the pins that are due
  // within SCHEDULING_HORIZON_MS (default 48h). Far-future pins stay
  // dispatchedAt-NULL in the DB and the worker's recurring dispatcher picks
  // them up as they slide into the window. If this fails mid-way, the
  // dispatcher's due-sweep backfills them anyway — enqueue failure never
  // loses data.
  let enqueuedNow = 0
  let deferredToDispatcher = 0
  try {
    const createdPins = await db.scheduledPin.findMany({
      where: { batchId: batch.id, status: 'queued' },
      select: { id: true, scheduledFor: true },
    })
    const result = await enqueuePinJobsWithinHorizon(createdPins, BULK_CHUNK)
    enqueuedNow = result.enqueued
    deferredToDispatcher = result.deferred
  } catch (err: any) {
    console.error('[bulk] Bulk enqueue failed (dispatcher will backfill due pins):', err.message)
  }

  // Calculate the total span of this import — last pin's time minus now, in days
  const effectiveDailyTarget = Math.max(1, Math.floor(86400 / intervalSeconds))
  const totalSpanSeconds = Math.max(0, effectiveValid - 1) * intervalSeconds
  const totalDays = Math.max(1, Math.ceil(totalSpanSeconds / 86400))

  await db.importBatch.update({
    where: { id: batch.id },
    data: { queuedRows: queueIndex, status: 'processing' },
  })

  return NextResponse.json({
    batch: { ...batch, _count: { rows: batchRows.length } },
    validRows: effectiveValid,
    invalidRows,
    truncatedRows,
    fieldLimits: PIN_LIMITS,
    dailyTarget: effectiveDailyTarget, // informational only — "roughly N pins/day at this interval"
    dailyPinLimit,
    totalDays,
    intervalSeconds: Math.round(intervalSeconds * 100) / 100,
    intervalMinutes: Math.round((intervalSeconds / 60) * 100) / 100,
    // How many pins went straight into Redis vs. stay in Postgres for the
    // dispatcher to pick up within the 48h window
    enqueuedNow,
    deferredToDispatcher,
    // Per-row preview (cap at 200 rows to keep payload reasonable; full list via /api/import-batches)
    previewRows: previewRows.slice(0, 200),
    // Up to 50 sample validation errors for the frontend to display
    errors: errorSamples.slice(0, 50),
    // List of available board names for this connection — helps the user fix their CSV
    availableBoards: availableBoardNames,
    // Diagnostic info — shows what headers were detected and the first row's values.
    // This makes it instantly obvious if the CSV has wrong column names, BOM, etc.
    diagnostic: {
      detectedHeaders: csvHeaders,
      firstRow: rows[0] || null,
      totalRowsParsed: rows.length,
      boardCount: boards.length,
    },
  })
}
