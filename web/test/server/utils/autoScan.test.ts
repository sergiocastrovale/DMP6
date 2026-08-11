import { describe, expect, it } from 'vitest'
import { MIN_AUTO_SCAN_INTERVAL_HOURS, shouldRunAutoScan } from '../../../server/utils/autoScan'

const hoursAgo = (h: number, from: Date) => new Date(from.getTime() - h * 60 * 60_000)

describe('shouldRunAutoScan', () => {
  const now = new Date('2026-08-11T12:00:00Z')

  it('never runs while the toggle is off, however long it has been', () => {
    expect(shouldRunAutoScan({ enabled: false, intervalHours: 12, lastRunAt: null }, now)).toBe(false)
    expect(shouldRunAutoScan({ enabled: false, intervalHours: 12, lastRunAt: hoursAgo(99, now) }, now)).toBe(false)
  })

  it('runs immediately when it has never run', () => {
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: null }, now)).toBe(true)
  })

  it('waits until a full interval has elapsed', () => {
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(11, now) }, now)).toBe(false)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(12, now) }, now)).toBe(true)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(13, now) }, now)).toBe(true)
  })

  it('floors the interval so a 0/negative setting cannot scan on every tick', () => {
    const justRan = { enabled: true, intervalHours: 0, lastRunAt: hoursAgo(MIN_AUTO_SCAN_INTERVAL_HOURS / 2, now) }
    expect(shouldRunAutoScan(justRan, now)).toBe(false)
    expect(shouldRunAutoScan({ ...justRan, lastRunAt: hoursAgo(MIN_AUTO_SCAN_INTERVAL_HOURS, now) }, now)).toBe(true)
  })

  it('does not fire on a timestamp in the future (clock jumped backwards)', () => {
    const future = new Date(now.getTime() + 60 * 60_000)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: future }, now)).toBe(false)
  })
})
