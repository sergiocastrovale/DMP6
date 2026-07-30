import { describe, expect, it } from 'vitest'
import { isSongkongStalled, SONGKONG_STALE_AFTER_MIN } from '../../../server/utils/songkongSettings'

const minutesAgo = (min: number, from: Date) => new Date(from.getTime() - min * 60_000)

describe('isSongkongStalled', () => {
  const now = new Date('2026-01-01T12:00:00Z')

  it('is never stalled when nothing is ENRICHING', () => {
    expect(isSongkongStalled({ enrichingRows: [], lastDrainedAt: null, now })).toBe(false)
  })

  it('is not stalled while the oldest row is still within the grace window', () => {
    const rows = [{ updatedAt: minutesAgo(SONGKONG_STALE_AFTER_MIN - 1, now) }]
    expect(isSongkongStalled({ enrichingRows: rows, lastDrainedAt: null, now })).toBe(false)
  })

  it('is stalled once the oldest row exceeds the grace window and nothing has ever drained', () => {
    const rows = [{ updatedAt: minutesAgo(SONGKONG_STALE_AFTER_MIN + 1, now) }]
    expect(isSongkongStalled({ enrichingRows: rows, lastDrainedAt: null, now })).toBe(true)
  })

  it('is NOT stalled if a row recently drained successfully, even with an old row still waiting', () => {
    const rows = [{ updatedAt: minutesAgo(SONGKONG_STALE_AFTER_MIN + 20, now) }]
    const lastDrainedAt = minutesAgo(1, now) // the drainer just finished something else
    expect(isSongkongStalled({ enrichingRows: rows, lastDrainedAt, now })).toBe(false)
  })

  it('is stalled again once too much time has passed since the last successful drain', () => {
    const rows = [{ updatedAt: minutesAgo(SONGKONG_STALE_AFTER_MIN + 20, now) }]
    const lastDrainedAt = minutesAgo(SONGKONG_STALE_AFTER_MIN + 5, now)
    expect(isSongkongStalled({ enrichingRows: rows, lastDrainedAt, now })).toBe(true)
  })
})
