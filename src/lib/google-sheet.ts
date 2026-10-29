// ─── Google Sheet URL → CSV import (SSRF-safe by construction) ──────────
//
// SECURITY MODEL — this is the only place in the app that fetches a URL
// derived from user input, so it deserves an explicit note:
//
//  1. We NEVER fetch the URL the user pasted. We only PARSE it, extract a
//     strictly-validated spreadsheet ID (+ optional numeric gid), and then
//     build the fetch URL OURSELVES:
//         https://docs.google.com/spreadsheets/d/<id>/export?format=csv[&gid=<gid>]
//     The ID regex is ^[a-zA-Z0-9_-]{10,100}$ — no slashes, dots, percent
//     escapes, or userinfo tricks can survive it.
//  2. Hostname allowlist: only https://docs.google.com URLs with a
//     /spreadsheets/d/{id} path parse successfully. Everything else
//     (evil.com, localhost, 169.254.169.254, docs.google.com@evil.com,
//     docs.google.com.evil.com, javascript:, data:) is rejected BEFORE any
//     network call happens.
//  3. Redirects: Google may 302 (login walls, internal hosts). We follow
//     them (redirect: 'follow') but then verify the FINAL response URL is
//     still a Google-owned host (*.google.com / *.googleusercontent.com) —
//     if it ever lands anywhere else, the response is discarded.
//  4. Bounded work: 20s AbortSignal.timeout, and the body is read with a
//     hard byte cap so a huge "sheet" can never buffer the app container.
//  5. Private sheets: Google answers login walls with 200 text/html —
//     we detect that and return a friendly share-your-sheet error instead
//     of importing garbage rows.
//
// The fetched CSV then goes through the exact same bulk-import pipeline as
// an uploaded file (src/lib/bulk-import.ts) — same plan limits, quotas,
// throttles and scheduling.

// Hard cap on a fetched sheet — same budget as the CSV upload path.
// Sizes are enforced on BYTES as they stream in, before anything is buffered.
const MAX_SHEET_BYTES = 30 * 1024 * 1024

// Fetch budget — well under the 2-minute orphan window, consistent with the
// 10–30s timeouts used by the other outbound calls in the app.
const SHEET_FETCH_TIMEOUT_MS = 20_000

// After any redirects, the response must still come from a Google-owned
// host — anything else is discarded (see SECURITY MODEL §3).
export const ALLOWED_FINAL_HOSTS = /^(\S+\.)?(google\.com|googleusercontent\.com)$/i

export class SheetUrlError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SheetUrlError'
    this.status = status
  }
}

/**
 * Parse a user-pasted Google Sheets URL into { spreadsheetId, gid }.
 * Throws a SheetUrlError with a user-friendly message on anything that is
 * not a canonical https://docs.google.com/spreadsheets/d/{id}… URL.
 *
 * Accepts the common shapes users paste:
 *   https://docs.google.com/spreadsheets/d/ID/edit
 *   https://docs.google.com/spreadsheets/d/ID/edit#gid=123
 *   https://docs.google.com/spreadsheets/d/ID/edit?gid=123
 *   https://docs.google.com/spreadsheets/d/ID/edit?usp=sharing
 *   https://docs.google.com/spreadsheets/d/ID/export?format=csv
 *   https://docs.google.com/spreadsheets/d/ID/copy
 */
export function parseGoogleSheetUrl(rawUrl: string): { spreadsheetId: string; gid: string | null } {
  const raw = (rawUrl || '').trim()
  if (!raw) throw new SheetUrlError('Please paste your Google Sheet URL.')

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new SheetUrlError('That does not look like a valid URL. Copy the full URL from your browser address bar while the sheet is open.')
  }

  // Strict transport + strict host. new URL() keeps userinfo/hostname apart,
  // so "https://docs.google.com@evil.com/…" has hostname evil.com → rejected.
  // Subdomains of docs.google.com are NOT allowed (no wildcard here).
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') {
    throw new SheetUrlError('Only Google Sheets URLs are supported — the URL must start with https://docs.google.com/spreadsheets/d/')
  }

  // /spreadsheets/d/{id} — ID is [a-zA-Z0-9_-] only, bounded length.
  const m = u.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,100})(\/|$)/)
  if (!m) {
    throw new SheetUrlError('Could not find the spreadsheet ID in that URL. Open your sheet in the browser and copy the URL from the address bar (it looks like https://docs.google.com/spreadsheets/d/…/edit).')
  }
  const spreadsheetId = m[1]

  // The tab (gid) may arrive as a query param (?gid=), or as a URL fragment
  // (#gid=…) — the fragment never leaves the browser, but users paste the
  // whole string anyway, so we read both.
  let gid: string | null = null
  const queryGid = u.searchParams.get('gid')
  const fragment = u.hash || ''
  const fragmentMatch = fragment.match(/[#&]gid=(\d{1,15})/)
  if (queryGid !== null) {
    if (!/^\d{1,15}$/.test(queryGid)) throw new SheetUrlError('Invalid gid in the URL.')
    gid = queryGid
  } else if (fragmentMatch) {
    gid = fragmentMatch[1]
  }

  return { spreadsheetId, gid }
}

/**
 * Fetch the given spreadsheet's data as CSV text from Google's export
 * endpoint. The URL is built from the validated ID — never from user input.
 * Throws SheetUrlError (with a user-facing message) on every failure mode.
 */
export async function fetchSheetAsCsv(spreadsheetId: string, gid: string | null): Promise<{ csvText: string }> {
  const exportUrl =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv` +
    (gid ? `&gid=${encodeURIComponent(gid)}` : '')

  let res: Response
  try {
    res = await fetch(exportUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(SHEET_FETCH_TIMEOUT_MS),
      // No cookies, no credentials — we only ever read public/link-shared sheets.
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'text/csv' },
    })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new SheetUrlError(
      isTimeout
        ? 'Google Sheets took too long to respond (over 20 seconds). Try again, or download the sheet as CSV and upload the file instead.'
        : 'Could not reach Google Sheets. Check the URL and your connection, or download the sheet as CSV and upload the file instead.',
      502,
    )
  }

  // Defense in depth: even though we built the URL ourselves, verify the
  // FINAL response (after any redirects) still came from a Google host.
  try {
    const finalHost = new URL(res.url || exportUrl).hostname
    if (!ALLOWED_FINAL_HOSTS.test(finalHost)) {
      throw new SheetUrlError('Google Sheets redirected somewhere unexpected — import aborted for safety.', 502)
    }
  } catch (e) {
    if (e instanceof SheetUrlError) throw e
    throw new SheetUrlError('Could not verify the Google Sheets response.', 502)
  }

  // Google answers a login wall with 200 + text/html (or 30x → 200 html).
  // Detect it and give the user the exact sharing steps instead of parsing
  // HTML as CSV (which would fail with a confusing "missing columns" error).
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new SheetUrlError(
      'This Google Sheet is not shared with the app. In your sheet, click File → Share → "Anyone with the link" (Viewer), or File → Share → Publish to web, then try again.',
      400,
    )
  }

  if (!res.ok) {
    // 404 = wrong/deleted ID; 401/403 = not shared enough; 429 = Google rate limit.
    throw new SheetUrlError(
      res.status === 404
        ? 'Google Sheets could not find that sheet — the URL may be wrong or the sheet deleted.'
        : `Google Sheets refused the export (HTTP ${res.status}). Double-check the sharing settings ("Anyone with the link" can view) and try again.`,
      502,
    )
  }

  // Early size rejection when Google tells us the length up-front.
  const declaredLength = Number(res.headers.get('content-length') || '0')
  if (declaredLength > MAX_SHEET_BYTES) {
    throw new SheetUrlError(
      `That sheet is too large (max ${Math.round(MAX_SHEET_BYTES / 1024 / 1024)} MB). Split the data across multiple sheets or import a smaller range.`,
      413,
    )
  }

  // Stream-read the body with a hard byte cap — never buffer an unbounded
  // response into the app container's memory.
  let csvText: string
  if (res.body) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value?.byteLength || 0
        if (total > MAX_SHEET_BYTES) {
          await reader.cancel().catch(() => {})
          throw new SheetUrlError(
            `That sheet is too large (max ${Math.round(MAX_SHEET_BYTES / 1024 / 1024)} MB). Split the data across multiple sheets or import a smaller range.`,
            413,
          )
        }
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    csvText = new TextDecoder('utf-8').decode(concatChunks(chunks, total))
  } else {
    csvText = await res.text()
    if (csvText.length > MAX_SHEET_BYTES) {
      throw new SheetUrlError(
        `That sheet is too large (max ${Math.round(MAX_SHEET_BYTES / 1024 / 1024)} MB). Split the data across multiple sheets or import a smaller range.`,
        413,
      )
    }
  }

  // A truly empty body (0 bytes) is always a sharing/publishing problem,
  // never a valid import — fail with the sharing instructions.
  if (csvText.trim().length === 0) {
    throw new SheetUrlError(
      'Google returned an empty sheet. Make sure the tab is not empty and the sheet is shared ("Anyone with the link" can view).',
      400,
    )
  }

  return { csvText }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}
