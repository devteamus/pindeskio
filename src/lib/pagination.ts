// ─── Pagination Helper ─────────────────────────────────────────────
// Centralized pagination parsing to prevent DoS via huge `limit` values.
// All paginated API endpoints should use this instead of raw parseInt(limit).

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 200 // Hard cap — prevents ?limit=999999999 memory exhaustion

export function parsePagination(searchParams: URLSearchParams): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
  const requestedLimit = parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE
  const limit = Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE)
  const skip = (page - 1) * limit
  return { page, limit, skip }
}
