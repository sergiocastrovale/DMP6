import { describe, expect, it } from 'vitest'
import { computeDownloadPercent, sumFileBytes } from '../../../server/utils/downloadProgress'

describe('sumFileBytes', () => {
  it('sums the size field of a files array', () => {
    expect(sumFileBytes([{ size: 100 }, { size: 250 }])).toBe(350)
  })

  it('treats missing/non-array/malformed input as zero', () => {
    expect(sumFileBytes(null)).toBe(0)
    expect(sumFileBytes(undefined)).toBe(0)
    expect(sumFileBytes([{}, { size: 'nope' }])).toBe(0)
  })
})

describe('computeDownloadPercent', () => {
  it('reports 100% for completed-family statuses regardless of bytes', () => {
    for (const status of ['ENRICHING', 'READY', 'PROMOTED'] as const) {
      const result = computeDownloadPercent({ status, bytesTransferred: 0, files: [] })
      expect(result.percent).toBe(100)
    }
  })

  it('caps DOWNLOADING at 99% even when bytes reach the total', () => {
    const result = computeDownloadPercent({
      status: 'DOWNLOADING',
      bytesTransferred: 1000,
      files: [{ size: 1000 }],
    })
    expect(result.percent).toBe(99)
  })

  it('computes a proportional DOWNLOADING percent below the cap', () => {
    const result = computeDownloadPercent({
      status: 'DOWNLOADING',
      bytesTransferred: 250,
      files: [{ size: 1000 }],
    })
    expect(result.percent).toBe(25)
  })

  it('returns 0% DOWNLOADING when there are no queued files yet', () => {
    const result = computeDownloadPercent({ status: 'DOWNLOADING', bytesTransferred: 0, files: [] })
    expect(result.percent).toBe(0)
    expect(result.totalBytes).toBe(0)
  })

  it('reports a best-effort fraction for FAILED/ABANDONED (not capped at 99)', () => {
    const result = computeDownloadPercent({
      status: 'FAILED',
      bytesTransferred: 1000,
      files: [{ size: 1000 }],
    })
    expect(result.percent).toBe(100)
  })

  it('handles BigInt bytesTransferred', () => {
    const result = computeDownloadPercent({
      status: 'DOWNLOADING',
      bytesTransferred: 500n,
      files: [{ size: 1000 }],
    })
    expect(result.percent).toBe(50)
    expect(result.bytesTransferred).toBe(500)
  })

  it('handles null bytesTransferred and non-array files', () => {
    const result = computeDownloadPercent({ status: 'DOWNLOADING', bytesTransferred: null, files: null })
    expect(result).toEqual({ percent: 0, bytesTransferred: 0, totalBytes: 0 })
  })

  it('ignores files with missing/non-numeric size', () => {
    const result = computeDownloadPercent({
      status: 'DOWNLOADING',
      bytesTransferred: 50,
      files: [{ size: 100 }, {}, { size: 'nope' as unknown as number }],
    })
    expect(result.totalBytes).toBe(100)
  })
})
