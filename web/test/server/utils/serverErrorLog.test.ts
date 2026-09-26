import { describe, expect, it } from 'vitest'
import { formatServerError, isServerError, statusOf } from '../../../server/utils/serverErrorLog'

describe('statusOf / isServerError', () => {
  it('reads an h3 statusCode, defaulting to 500 for a plain throw', () => {
    expect(statusOf({ statusCode: 404 })).toBe(404)
    expect(statusOf(new Error('boom'))).toBe(500)
    expect(statusOf({ statusCode: 'x' })).toBe(500)
    expect(statusOf({ statusCode: 99 })).toBe(500)
    expect(statusOf(null)).toBe(500)
  })

  it('only 5xx are server errors', () => {
    expect([200, 400, 404, 499].some(isServerError)).toBe(false)
    expect([500, 503, 504].every(isServerError)).toBe(true)
  })
})

describe('formatServerError', () => {
  const now = new Date('2026-09-26T12:00:00.000Z')

  it('includes method, path, status, user, duration, message and stack', () => {
    const error = Object.assign(new Error('relation does not exist'), { stack: 'Error: relation does not exist\n    at handler (x.ts:1:1)' })
    const line = formatServerError({ method: 'GET', path: '/api/stats/tracks', status: 500, userId: 7, durationMs: 1234, error }, now)
    expect(line).toBe('[2026-09-26T12:00:00.000Z][error] GET /api/stats/tracks -> 500 user=7 1234ms: relation does not exist\nError: relation does not exist\n    at handler (x.ts:1:1)')
  })

  it('copes with no user, no duration, and a non-Error throw', () => {
    expect(formatServerError({ method: 'POST', path: '/api/x', status: 503, error: 'nope' }, now))
      .toBe('[2026-09-26T12:00:00.000Z][error] POST /api/x -> 503 user=-: nope')
  })
})
