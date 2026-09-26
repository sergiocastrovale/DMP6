import { describe, expect, it } from 'vitest'
import { periodStart } from '../../../server/utils/userPlays'

// Fixed reference instant so every case is deterministic regardless of when the suite runs.
const NOW = new Date('2026-06-15T14:30:00Z')

describe('periodStart', () => {
  it('today starts at midnight UTC by default', () => {
    expect(periodStart('today', NOW)).toEqual(new Date('2026-06-15T00:00:00Z'))
  })

  it('week is a trailing 7-day window, not the current calendar week', () => {
    expect(periodStart('week', NOW)).toEqual(new Date(NOW.getTime() - 7 * 86400000))
  })

  it('month starts on the 1st of the current calendar month', () => {
    expect(periodStart('month', NOW)).toEqual(new Date('2026-06-01T00:00:00Z'))
  })

  it('year starts on Jan 1st of the current calendar year', () => {
    expect(periodStart('year', NOW)).toEqual(new Date('2026-01-01T00:00:00Z'))
  })

  it('defaults `now` to the current time when omitted', () => {
    const before = Date.now()
    const start = periodStart('today')
    expect(start.getTime()).toBeLessThanOrEqual(before)
  })

  it('draws the boundaries on the listener\'s calendar, not UTC', () => {
    // 00:30 on the 16th in Lisbon (UTC+1 in summer) is still the 15th 23:30 UTC.
    const lateEvening = new Date('2026-06-15T23:30:00Z')
    expect(periodStart('today', lateEvening, 'Europe/Lisbon')).toEqual(new Date('2026-06-15T23:00:00Z'))
    expect(periodStart('today', lateEvening, 'UTC')).toEqual(new Date('2026-06-15T00:00:00Z'))
    // New York (UTC-4): 02:00Z on the 16th is still the 15th there.
    expect(periodStart('today', new Date('2026-06-16T02:00:00Z'), 'America/New_York')).toEqual(new Date('2026-06-15T04:00:00Z'))
    expect(periodStart('month', new Date('2026-07-01T02:00:00Z'), 'America/New_York')).toEqual(new Date('2026-06-01T04:00:00Z'))
    expect(periodStart('year', new Date('2027-01-01T02:00:00Z'), 'America/New_York')).toEqual(new Date('2026-01-01T05:00:00Z'))
  })
})
