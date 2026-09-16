import { describe, expect, it } from 'vitest'
import { periodStart } from '../../../server/utils/userPlays'

// Fixed reference instant so every case is deterministic regardless of when the suite runs.
const NOW = new Date('2026-06-15T14:30:00')

describe('periodStart', () => {
  it('today starts at local midnight', () => {
    expect(periodStart('today', NOW)).toEqual(new Date(2026, 5, 15, 0, 0, 0))
  })

  it('week is a trailing 7-day window, not the current calendar week', () => {
    expect(periodStart('week', NOW)).toEqual(new Date(NOW.getTime() - 7 * 86400000))
  })

  it('month starts on the 1st of the current calendar month', () => {
    expect(periodStart('month', NOW)).toEqual(new Date(2026, 5, 1, 0, 0, 0))
  })

  it('year starts on Jan 1st of the current calendar year', () => {
    expect(periodStart('year', NOW)).toEqual(new Date(2026, 0, 1, 0, 0, 0))
  })

  it('defaults `now` to the current time when omitted', () => {
    const before = Date.now()
    const start = periodStart('today')
    expect(start.getTime()).toBeLessThanOrEqual(before)
  })
})
