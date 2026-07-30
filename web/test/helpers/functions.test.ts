import { describe, expect, it, vi } from 'vitest'
import {
  downloadSubpage,
  filterQueue,
  formatDate,
  formatDuration,
  formatFileSize,
  formatNumber,
  formatPlaytime,
  formatSpeed,
  parseProgress,
  sortItems,
  timeAgo,
} from '../../helpers/functions'
import type { DownloadedReleaseItem } from '../../types/download'

describe('parseProgress', () => {
  it('scans backwards for the latest PROGRESS: line', () => {
    const result = parseProgress(['noise', 'PROGRESS:{"pct":10}', 'PROGRESS:{"pct":50}', 'noise'])
    expect(result).toEqual({ pct: 50 })
  })

  it('returns null when no PROGRESS line is present', () => {
    expect(parseProgress(['a', 'b'])).toBeNull()
  })

  it('ignores a malformed PROGRESS line and keeps scanning', () => {
    const result = parseProgress(['PROGRESS:{"pct":1}', 'PROGRESS:not-json'])
    expect(result).toEqual({ pct: 1 })
  })

  it('returns null for an empty array', () => {
    expect(parseProgress([])).toBeNull()
  })
})

describe('filterQueue', () => {
  const items = [
    { artist: 'Boards of Canada', title: 'Geogaddi', year: 2002 },
    { artist: 'Aphex Twin', title: 'Drukqs', year: 2001 },
    { artist: null, title: 'Untitled', year: 1999 },
  ] as unknown as DownloadedReleaseItem[]

  it('passes everything through on an empty query', () => {
    expect(filterQueue(items, '')).toEqual(items)
    expect(filterQueue(items, '   ')).toEqual(items)
  })

  it('matches case-insensitively on artist', () => {
    expect(filterQueue(items, 'BOARDS')).toEqual([items[0]])
  })

  it('matches on title', () => {
    expect(filterQueue(items, 'drukqs')).toEqual([items[1]])
  })

  it('matches on year', () => {
    expect(filterQueue(items, '1999')).toEqual([items[2]])
  })

  it('tolerates a null artist', () => {
    expect(filterQueue(items, 'untitled')).toEqual([items[2]])
  })
})

describe('sortItems', () => {
  it('sorts numbers numerically', () => {
    const out = sortItems([{ n: 10 }, { n: 2 }, { n: 30 }], i => i.n, 'asc')
    expect(out.map(i => i.n)).toEqual([2, 10, 30])
  })

  it('sorts strings via localeCompare', () => {
    const out = sortItems([{ s: 'banana' }, { s: 'apple' }], i => i.s, 'asc')
    expect(out.map(i => i.s)).toEqual(['apple', 'banana'])
  })

  it('reverses for desc', () => {
    const out = sortItems([{ n: 1 }, { n: 2 }], i => i.n, 'desc')
    expect(out.map(i => i.n)).toEqual([2, 1])
  })

  it('sinks nulls/undefined to the bottom of the ascending sort', () => {
    const items = [{ n: 5 }, { n: null }, { n: 1 }, { n: undefined }]
    const asc = sortItems(items, i => i.n as number | null, 'asc')
    expect(asc.map(i => i.n)).toEqual([1, 5, null, undefined])
  })

  it('desc reverses the whole ascending result, so nulls end up on top (not sunk for desc)', () => {
    const items = [{ n: 5 }, { n: null }, { n: 1 }, { n: undefined }]
    const desc = sortItems(items, i => i.n as number | null, 'desc')
    expect(desc.map(i => i.n)).toEqual([undefined, null, 5, 1])
  })

  it('does not mutate the input array', () => {
    const input = [{ n: 3 }, { n: 1 }]
    const copy = [...input]
    sortItems(input, i => i.n, 'asc')
    expect(input).toEqual(copy)
  })
})

describe('downloadSubpage', () => {
  it('maps every known state to its subpage', () => {
    expect(downloadSubpage('READY')).toBe('/downloads/merge')
    expect(downloadSubpage('FAILED')).toBe('/downloads/failed')
    expect(downloadSubpage('ABANDONED')).toBe('/downloads/failed')
    expect(downloadSubpage('UNAVAILABLE')).toBe('/downloads/unavailable')
    expect(downloadSubpage('PROMOTED')).toBe('/downloads/history')
    expect(downloadSubpage('REJECTED')).toBe('/downloads/history')
    expect(downloadSubpage('INVALID')).toBe('/downloads/history')
  })

  it('defaults to the downloading tab for DOWNLOADING/ENRICHING/unknown/null', () => {
    expect(downloadSubpage('DOWNLOADING')).toBe('/downloads/downloading')
    expect(downloadSubpage('ENRICHING')).toBe('/downloads/downloading')
    expect(downloadSubpage(null)).toBe('/downloads/downloading')
    expect(downloadSubpage(undefined)).toBe('/downloads/downloading')
    expect(downloadSubpage('SOMETHING_ELSE')).toBe('/downloads/downloading')
  })
})

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(600)).toBe('10:00')
    expect(formatDuration(5)).toBe('0:05')
  })

  it('guards null/0/non-finite', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(Infinity)).toBe('0:00')
    expect(formatDuration(NaN)).toBe('0:00')
  })
})

describe('formatPlaytime', () => {
  it('returns "0 seconds" for exactly 0', () => {
    expect(formatPlaytime(0)).toBe('0 seconds')
  })

  it('returns "< 1 minute" for a small positive value under a minute', () => {
    expect(formatPlaytime(30)).toBe('< 1 minute')
  })

  it('pluralizes correctly', () => {
    expect(formatPlaytime(60)).toBe('1 minute')
    expect(formatPlaytime(120)).toBe('2 minutes')
    expect(formatPlaytime(3600)).toBe('1 hour')
    expect(formatPlaytime(7200)).toBe('2 hours')
  })

  it('composes multiple units, largest first', () => {
    // 1 day, 2 hours, 3 minutes
    const secs = 86400 + 2 * 3600 + 3 * 60
    expect(formatPlaytime(secs)).toBe('1 day, 2 hours, 3 minutes')
  })
})

describe('formatNumber', () => {
  it('delegates to toLocaleString', () => {
    expect(formatNumber(1234)).toBe((1234).toLocaleString())
  })
})

describe('formatDate', () => {
  it('returns "Never" for null', () => {
    expect(formatDate(null)).toBe('Never')
  })

  it('formats a date in pt-PT locale', () => {
    const result = formatDate('2024-03-15T10:30:00.000Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toBe(new Date('2024-03-15T10:30:00.000Z').toLocaleDateString('pt-PT', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }))
  })
})

describe('timeAgo', () => {
  it('returns empty string for null', () => {
    expect(timeAgo(null)).toBe('')
  })

  it('returns "just now" for very recent timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:30Z'))
    expect(timeAgo('2024-01-01T00:00:00Z')).toBe('just now')
    vi.useRealTimers()
  })

  it('returns minutes for under an hour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:05:00Z'))
    expect(timeAgo('2024-01-01T00:00:00Z')).toBe('5m ago')
    vi.useRealTimers()
  })

  it('returns hours for under a day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T03:00:00Z'))
    expect(timeAgo('2024-01-01T00:00:00Z')).toBe('3h ago')
    vi.useRealTimers()
  })

  it('returns days beyond 24h', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-03T00:00:00Z'))
    expect(timeAgo('2024-01-01T00:00:00Z')).toBe('2d ago')
    vi.useRealTimers()
  })
})

describe('formatFileSize', () => {
  it('returns "0 B" for 0/negative/falsy', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(-5)).toBe('0 B')
  })

  it('formats bytes through terabytes', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatFileSize(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(formatFileSize(3 * 1024 ** 4)).toBe('3.0 TB')
  })

  it('drops the decimal once the value reaches 10', () => {
    expect(formatFileSize(15 * 1024)).toBe('15 KB')
  })
})

describe('formatSpeed', () => {
  it('returns empty string for falsy input', () => {
    expect(formatSpeed(0)).toBe('')
  })

  it('uses KB/s under 1 MiB/s', () => {
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s')
  })

  it('uses MB/s at or above 1 MiB/s', () => {
    expect(formatSpeed(2 * 1_048_576)).toBe('2.0 MB/s')
  })
})
