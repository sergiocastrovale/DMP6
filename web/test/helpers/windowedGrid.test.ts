import { describe, expect, it } from 'vitest'
import { columnCountFromTemplate, computeGridWindow } from '../../helpers/windowedGrid'

const base = { itemCount: 1000, cols: 5, rowStride: 300, viewportHeight: 900, overscanRows: 2 }

describe('computeGridWindow', () => {
  it('at the top renders the first visible rows plus overscan, padding out the rest', () => {
    const w = computeGridWindow({ ...base, offsetIntoGrid: 0 })
    // 900px / 300px = 3 visible rows, +2 overscan = 5 rows = 25 items; 200 rows in total.
    expect(w).toEqual({ start: 0, end: 25, padTop: 0, padBottom: 195 * 300 })
  })

  it('in the middle keeps overscan rows on both sides', () => {
    const w = computeGridWindow({ ...base, offsetIntoGrid: 30_000 })
    // first visible row 100, last visible (exclusive) 103 -> rows 98..105.
    expect(w.start).toBe(98 * 5)
    expect(w.end).toBe(105 * 5)
    expect(w.padTop).toBe(98 * 300)
    expect(w.padBottom).toBe((200 - 105) * 300)
  })

  it('keeps the total height identical to rendering every row', () => {
    for (const offset of [-5000, 0, 1234, 30_000, 59_000, 200_000]) {
      const w = computeGridWindow({ ...base, offsetIntoGrid: offset })
      const renderedRows = Math.ceil((w.end - w.start) / base.cols)
      expect(w.padTop + renderedRows * base.rowStride + w.padBottom).toBe(200 * base.rowStride)
    }
  })

  it('a grid still below the fold renders only the first rows', () => {
    const w = computeGridWindow({ ...base, offsetIntoGrid: -10_000 })
    expect(w.start).toBe(0)
    expect(w.padTop).toBe(0)
    expect(w.end).toBeLessThanOrEqual(2 * base.cols)
  })

  it('scrolled past the end clamps to the last rows', () => {
    const w = computeGridWindow({ ...base, offsetIntoGrid: 1_000_000 })
    expect(w.end).toBe(1000)
    expect(w.padBottom).toBe(0)
    expect(w.start).toBeLessThanOrEqual(1000)
  })

  it('a partial last row is included', () => {
    const w = computeGridWindow({ ...base, itemCount: 998, offsetIntoGrid: 59_000 })
    expect(w.end).toBe(998)
  })

  it('degenerate input renders everything', () => {
    expect(computeGridWindow({ ...base, cols: 0, offsetIntoGrid: 0 })).toEqual({ start: 0, end: 1000, padTop: 0, padBottom: 0 })
    expect(computeGridWindow({ ...base, itemCount: 0, offsetIntoGrid: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    expect(computeGridWindow({ ...base, rowStride: 0, offsetIntoGrid: 0 }).end).toBe(1000)
  })
})

describe('columnCountFromTemplate', () => {
  it('counts the resolved tracks', () => {
    expect(columnCountFromTemplate('190px 190px 190px 190px')).toBe(4)
    expect(columnCountFromTemplate('187.5px 187.5px')).toBe(2)
    expect(columnCountFromTemplate('none')).toBe(0)
    expect(columnCountFromTemplate('')).toBe(0)
  })
})
