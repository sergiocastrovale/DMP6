import { describe, expect, it } from 'vitest'
import { DEFAULT_TIME_ZONE, resolveTimeZone, zonedDate, zonedMidnight } from '../../../server/utils/timezone'

describe('resolveTimeZone', () => {
  it('keeps a real IANA zone', () => {
    expect(resolveTimeZone('Europe/Lisbon')).toBe('Europe/Lisbon')
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York')
  })

  it('falls back to UTC for anything else', () => {
    for (const bad of [undefined, null, '', 'Mars/Olympus', 'x'.repeat(100), 42, {}, ['UTC']]) {
      expect(resolveTimeZone(bad)).toBe(DEFAULT_TIME_ZONE)
    }
  })
})

describe('zonedMidnight', () => {
  it('is UTC midnight for UTC', () => {
    expect(zonedMidnight(2026, 3, 9, 'UTC')).toEqual(new Date('2026-03-09T00:00:00Z'))
  })

  it('respects the zone offset, including a half-hour zone', () => {
    expect(zonedMidnight(2026, 1, 15, 'Asia/Kolkata')).toEqual(new Date('2026-01-14T18:30:00Z'))
    expect(zonedMidnight(2026, 1, 15, 'Pacific/Auckland')).toEqual(new Date('2026-01-14T11:00:00Z'))
  })

  it('follows DST: winter and summer midnights in Lisbon differ by an hour', () => {
    expect(zonedMidnight(2026, 1, 10, 'Europe/Lisbon')).toEqual(new Date('2026-01-10T00:00:00Z'))
    expect(zonedMidnight(2026, 7, 10, 'Europe/Lisbon')).toEqual(new Date('2026-07-09T23:00:00Z'))
  })

  it('finds the right instant on the day of a DST change', () => {
    // Lisbon springs forward 2026-03-29 01:00 UTC; midnight that day is still UTC+0.
    expect(zonedMidnight(2026, 3, 29, 'Europe/Lisbon')).toEqual(new Date('2026-03-29T00:00:00Z'))
    // New York springs forward 2026-03-08 07:00 UTC; midnight that day is still UTC-5.
    expect(zonedMidnight(2026, 3, 8, 'America/New_York')).toEqual(new Date('2026-03-08T05:00:00Z'))
    expect(zonedMidnight(2026, 3, 9, 'America/New_York')).toEqual(new Date('2026-03-09T04:00:00Z'))
  })
})

describe('zonedDate', () => {
  it('reads the calendar date in the zone', () => {
    expect(zonedDate(new Date('2026-12-31T23:30:00Z'), 'Asia/Tokyo')).toEqual({ year: 2027, month: 1, day: 1 })
    expect(zonedDate(new Date('2026-12-31T23:30:00Z'), 'UTC')).toEqual({ year: 2026, month: 12, day: 31 })
  })
})
