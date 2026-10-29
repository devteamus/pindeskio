// ─── Google Sheet URL import — tests ────────────────────────────────────
//
// Covers the two NEW pieces of the feature:
//   1. parseGoogleSheetUrl — strict URL validation (the SSRF allowlist)
//   2. POST /api/pins/bulk/google-sheet — the route that fetches the
//      sheet's CSV and runs it through the shared bulk-import pipeline.
//
// Runs against the disposable local test stack
// (scripts/test-infra-start.sh → postgres :5433 / redis :6380).
// Network fetch to Google is MOCKED — no external API is called.

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'

// Route handlers fall back to next/headers cookies() when no valid
// x-session-token header is present. Outside a real Next.js request scope
// that call throws — mock it as "no cookies", exactly what an
// unauthenticated request looks like to the auth layer.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}))

import { NextRequest } from 'next/server'
import { parseGoogleSheetUrl, SheetUrlError } from '@/lib/google-sheet'
import { POST as sheetPOST } from '@/app/api/pins/bulk/google-sheet/route'
import { POST as csvPOST } from '@/app/api/pins/bulk/route'
import {
  createSessionToken,
  buildSessionData,
} from '@/lib/auth'
import { makeDeps, closeDeps, seedBase, SEED, type TestDeps } from './helpers'
import type { PrismaClient } from '@prisma/client'

const GS = {
  userA: 'gs-user-a',
  userB: 'gs-user-b', // second tenant — must not be able to import into A's connection
  connA: 'gs-conn-a',
  boardA: 'gs-board-a',
  boardNameA: 'GS Test Board',
}

// A realistic 44-char Google spreadsheet ID (fake — never fetched for real;
// every fetch is mocked or the URL is rejected before any network call).
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf'
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`

const tokenA = createSessionToken(buildSessionData({
  id: GS.userA, email: 'gsa@example.com', name: 'A', role: 'user', status: 'active', currentPlanId: SEED.planProId,
}))
const tokenB = createSessionToken(buildSessionData({
  id: GS.userB, email: 'gsb@example.com', name: 'B', role: 'user', status: 'active', currentPlanId: SEED.planProId,
}))

function req(
  url: string,
  opts: { method?: string; token?: string; body?: unknown; form?: FormData } = {},
): NextRequest {
  const headers = new Headers()
  if (opts.token) headers.set('x-session-token', opts.token)
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers.set('content-type', 'application/json')
  }
  return new NextRequest(`http://localhost:3000${url}`, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  })
}

// A valid 2-row sheet (matching the documented CSV format reference)
const SHEET_CSV =
  'title,description,board_name,image_url,destination_url,publish_at,alt_text\n' +
  `"Pin One","Desc one","${GS.boardNameA}",https://img.example.com/1.jpg,https://example.com/1,,\n` +
  `"Pin Two","Desc two","${GS.boardNameA}",https://img.example.com/2.jpg,,,` + '\n'

function csvResponse(text: string, overrides: { status?: number; headers?: Record<string, string>; url?: string } = {}) {
  const res = new Response(text, {
    status: overrides.status ?? 200,
    headers: { 'content-type': 'text/csv; charset=UTF-8', ...(overrides.headers || {}) },
  })
  if (overrides.url) Object.defineProperty(res, 'url', { value: overrides.url })
  return res
}

let deps: TestDeps
let db: PrismaClient

// fetch mock — every route test replaces it; the real Google endpoint is
// NEVER contacted from this suite.
let fetchCalls: { url: string }[] = []
function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  fetchCalls = []
  const fn = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url })
    return impl(url)
  }
  vi.stubGlobal('fetch', fn)
}

beforeAll(async () => {
  deps = await makeDeps('pin-publish') // same queue the real routes use
  db = deps.db
  await seedBase(db)

  // Fixtures: two tenant users; A has a connection + board.
  const mk = (id: string) => db.user.upsert({
    where: { id },
    create: {
      id,
      email: `${id}@example.com`,
      name: id,
      role: 'user',
      status: 'active',
      currentPlanId: SEED.planProId,
    },
    update: { status: 'active', currentPlanId: SEED.planProId },
  })
  await mk(GS.userA)
  await mk(GS.userB)
  await db.pinterestConnection.upsert({
    where: { id: GS.connA },
    create: { id: GS.connA, userId: GS.userA, accessToken: 'gs_test_token', status: 'active' },
    update: { status: 'active' },
  })
  await db.pinterestBoard.upsert({
    where: { id: GS.boardA },
    create: { id: GS.boardA, connectionId: GS.connA, pinterestBoardId: '777222777', boardName: GS.boardNameA, isActive: true },
    update: { connectionId: GS.connA, isActive: true, boardName: GS.boardNameA },
  })
})

beforeEach(async () => {
  // Isolate pin/batch tables between tests (same helper the other suites use)
  await deps.db.$executeRawUnsafe(`TRUNCATE TABLE "ScheduledPin", "UsageCounter", "ApiCallLog", "PinAnalyticsDaily", "ImportRow", "ImportBatch" CASCADE`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await closeDeps(deps)
})

// ═══ 1. parseGoogleSheetUrl — the SSRF allowlist (pure function) ═══════
describe('parseGoogleSheetUrl', () => {
  it('accepts the canonical /edit URL and extracts the spreadsheet ID', () => {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(SHEET_URL)
    expect(spreadsheetId).toBe(SHEET_ID)
    expect(gid).toBeNull()
  })

  it('accepts ?gid= and #gid= tab fragments', () => {
    expect(parseGoogleSheetUrl(`${SHEET_URL}?gid=12345`)).toMatchObject({ gid: '12345' })
    expect(parseGoogleSheetUrl(`${SHEET_URL}#gid=67890`)).toMatchObject({ gid: '67890' })
    expect(parseGoogleSheetUrl(`${SHEET_URL}?usp=sharing#gid=67890`)).toMatchObject({ gid: '67890' })
  })

  it('accepts /export and /copy variants', () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`).spreadsheetId).toBe(SHEET_ID)
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/copy`).spreadsheetId).toBe(SHEET_ID)
  })

  it('rejects non-https, wrong host, and userinfo tricks (SSRF)', () => {
    const bad = [
      '',
      'not a url',
      `http://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,             // http, not https
      'https://evil.com/spreadsheets/d/AAAAAAAAAAAAAAAAAAAA/edit',        // wrong host
      `https://docs.google.com@evil.com/spreadsheets/d/${SHEET_ID}/edit`, // userinfo trick → host is evil.com
      `https://docs.google.com.evil.com/spreadsheets/d/${SHEET_ID}/edit`,  // suffix trick
      `https://${'a'.repeat(30)}.docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, // no subdomain spoofing allowed
      'javascript:alert(1)',
      'https://docs.google.com/forms/d/AAAAAAAAAAAAAAAAAAAA/edit',          // wrong product path
      'https://docs.google.com/spreadsheets/d/',                            // no ID
      `https://docs.google.com/spreadsheets/d/${SHEET_ID.slice(0, 4)}/edit`, // ID too short
      'https://docs.google.com/spreadsheets/d/abc%2F..%2F..%2Fetc/passwd/edit', // encoded traversal in the ID
      'file:///etc/passwd',
    ]
    for (const url of bad) {
      expect(() => parseGoogleSheetUrl(url)).toThrow(SheetUrlError)
    }
  })

  it('rejects a non-numeric gid but keeps the rest of the URL valid', () => {
    expect(() => parseGoogleSheetUrl(`${SHEET_URL}?gid=../../secret`)).toThrow(SheetUrlError)
  })
})

// ═══ 2. Route — happy path through the shared pipeline ══════════════════
describe('POST /api/pins/bulk/google-sheet', () => {
  it('imports a shared sheet: valid rows are scheduled, invalid rows reported', async () => {
    mockFetch(() => csvResponse(SHEET_CSV))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.validRows).toBe(2)
    expect(data.invalidRows).toBe(0)
    expect(data.batch.originalFileName).toContain('Google Sheet (')
    expect(data.previewRows).toHaveLength(2)
    // The fetch URL we hit was built by US from the validated ID — it must be
    // Google's export endpoint, never the raw pasted URL.
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`)
    // DB: 2 scheduled pins, queued, on the right tenant + connection
    const pins = await db.scheduledPin.findMany({ where: { batchId: data.batch.id } })
    expect(pins).toHaveLength(2)
    expect(pins.every((p) => p.userId === GS.userA && p.connectionId === GS.connA && p.status === 'queued')).toBe(true)
  })

  it('imports the specific tab when the pasted URL contains a gid', async () => {
    mockFetch(() => csvResponse(SHEET_CSV))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: `${SHEET_URL}#gid=12345`, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(200)
    expect(fetchCalls[0].url).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=12345`)
  })

  it('flags invalid rows from a sheet exactly like the CSV path does', async () => {
    const csv =
      'title,board_name,image_url\n' +
      `"Good pin","${GS.boardNameA}",https://img.example.com/ok.jpg\n` +
      '"Bad pin","NoSuchBoard",https://img.example.com/x.jpg\n' +
      `"Bad image","${GS.boardNameA}",javascript:alert(1)\n`
    mockFetch(() => csvResponse(csv))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.validRows).toBe(1)
    expect(data.invalidRows).toBe(2)
    expect(data.errors.length).toBeGreaterThan(0)
  })

  it('requires authentication', async () => {
    mockFetch(() => csvResponse(SHEET_CSV))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  it('blocks another tenant from importing into a foreign connection', async () => {
    mockFetch(() => csvResponse(SHEET_CSV))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenB,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(404)
    expect(fetchCalls).toHaveLength(0) // rejected before any fetch
  })
})

// ═══ 3. Route — fetch failure modes (all mocked) ════════════════════════
describe('POST /api/pins/bulk/google-sheet — fetch failure modes', () => {
  it('rejects non-Google URLs BEFORE any network call (SSRF guard)', async () => {
    // fetch throws if it is somehow called — the test fails loudly if the
    // guard does not hold.
    mockFetch(() => { throw new Error('fetch must NOT be called for rejected URLs') })
    const bad = [
      'https://evil.com/spreadsheets/d/AAAAAAAAAAAAAAAAAAAA/edit',
      `https://docs.google.com@evil.com/spreadsheets/d/${SHEET_ID}/edit`,
      'https://docs.google.com/spreadsheets/d/short/edit',
      'http://docs.google.com/spreadsheets/d/AAAAAAAAAAAAAAAAAAAA/edit',
    ]
    for (const url of bad) {
      const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
        token: tokenA,
        body: { sheetUrl: url, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
      }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeTruthy()
    }
    expect(fetchCalls).toHaveLength(0)
  })

  it('private sheet (Google login wall = 200 text/html) → friendly sharing instructions, nothing imported', async () => {
    mockFetch(() => new Response('<html><title>Sign in</title></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    }))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Anyone with the link/i)
    expect(await db.importBatch.count({ where: { userId: GS.userA } })).toBe(0)
  })

  it('deleted/unknown sheet (Google 404) → 502 with a clear message', async () => {
    mockFetch(() => csvResponse('not found', { status: 404 }))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/could not find/i)
  })

  it('abort if the final (post-redirect) response is not a Google host', async () => {
    mockFetch(() => csvResponse(SHEET_CSV, { url: 'https://attacker.example.com/leaked.csv' }))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(502)
    expect(await db.scheduledPin.count({ where: { userId: GS.userA } })).toBe(0)
  })

  it('rejects an oversized sheet mid-stream (byte cap enforced while reading)', async () => {
    // A stream that would stream 31 MB — the cap is 30 MB, so the reader must
    // abort without buffering it all and the route returns 413.
    const oneMb = 'x'.repeat(1024 * 1024)
    mockFetch(() => new Response(
      new ReadableStream({
        start(controller) {
          let sent = 0
          const push = () => {
            if (sent >= 32) { controller.close(); return }
            controller.enqueue(new TextEncoder().encode(oneMb))
            sent++
            push()
          }
          push()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/csv' } },
    ))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toMatch(/too large/i)
  })

  it('sheet with wrong columns → the pipeline reports the missing headers', async () => {
    mockFetch(() => csvResponse('foo,bar\n1,2\n'))
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.missingColumns).toContain('title')
    expect(body.detectedHeaders).toEqual(['foo', 'bar'])
  })

  it('network timeout → friendly 502, not a hang', async () => {
    mockFetch(() => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    })
    const res = await sheetPOST(req('/api/pins/bulk/google-sheet', {
      token: tokenA,
      body: { sheetUrl: SHEET_URL, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60 },
    }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/20 seconds|CSV and upload/i)
  })
})

// ═══ 4. Shared per-user throttle — CSV and Google Sheet draw from the ═══
//        SAME hourly budget (keyed bulk-import:<userId>)
describe('shared import throttle', () => {
  it('429s the 21st import in an hour — alternating endpoints cannot extend the budget', async () => {
    mockFetch(() => csvResponse(
      'title,board_name,image_url\n' +
      `"p","${GS.boardNameA}",https://img.example.com/p.jpg\n`,
    ))
    const body = (sheetUrl: string) => ({
      sheetUrl, connectionId: GS.connA, importMode: 'auto', intervalSeconds: 60,
    })
    let saw429OnSheet = false
    for (let i = 0; i < 21; i++) {
      // Alternate the two endpoints — the budget is shared per USER,
      // so no matter the order, request #21 must be throttled.
      const res = i % 2 === 0
        ? await sheetPOST(req('/api/pins/bulk/google-sheet', { token: tokenA, body: body(SHEET_URL) }))
        : await csvPOST(req('/api/pins/bulk', {
            token: tokenA,
            form: (() => {
              const fd = new FormData()
              fd.append('file', new File(['title,board_name,image_url\n' + `"p","${GS.boardNameA}",https://img.example.com/p.jpg\n`], 'p.csv', { type: 'text/csv' }))
              fd.append('connectionId', GS.connA)
              fd.append('importMode', 'auto')
              fd.append('intervalSeconds', '60')
              return fd
            })(),
          }))
      if (res.status === 429) { saw429OnSheet = true; break }
      expect([200, 400]).toContain(res.status) // 200 import OR plan-level rejection
    }
    expect(saw429OnSheet).toBe(true)
  })
})
