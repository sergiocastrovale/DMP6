import { describe, expect, it, vi } from 'vitest'
import {
  canCancelDownload,
  canRejectDownload,
  canRequeueDownload,
  canRetryDownload,
  clampPage,
  downloadSubpage,
  filterQueue,
  formatDate,
  formatDuration,
  formatFileSize,
  formatNumber,
  formatPlaytime,
  formatSpeed,
  musicBrainzUrl,
  pageCount,
  paginate,
  parseDroppedLinks,
  parseProgress,
  scanSessionName,
  sortItems,
  timeAgo,
  toggleRowSelection,
} from '../../helpers/functions'
import { queueFilters } from '../../helpers/constants'
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

describe('parseDroppedLinks', () => {
  const warning = 'WARN: dropped 3 favourite(s) and 5 playlist entry(ies) for removed files'

  it('reads both counts from the index warning line', () => {
    expect(parseDroppedLinks(['Done.', warning, '════'])).toEqual({ favorites: 3, playlists: 5 })
  })

  it('returns null when no run dropped anything', () => {
    expect(parseDroppedLinks(['Done.', 'Files: 10 | New: 2'])).toBeNull()
    expect(parseDroppedLinks([])).toBeNull()
  })

  it('keeps the latest warning when a session ran twice', () => {
    const older = 'WARN: dropped 1 favourite(s) and 1 playlist entry(ies) for removed files'
    expect(parseDroppedLinks([older, 'Done.', warning])).toEqual({ favorites: 3, playlists: 5 })
  })

  it('ignores non-string lines (the store also buffers structured entries)', () => {
    expect(parseDroppedLinks([{ foo: 1 } as any, warning])).toEqual({ favorites: 3, playlists: 5 })
  })

  it('reports zero counts rather than null when the run dropped none of one kind', () => {
    const line = 'WARN: dropped 0 favourite(s) and 2 playlist entry(ies) for removed files'
    expect(parseDroppedLinks([line])).toEqual({ favorites: 0, playlists: 2 })
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
    expect(downloadSubpage('FAILED')).toBe('/downloads/queue?filter=failed')
    expect(downloadSubpage('ABANDONED')).toBe('/downloads/queue?filter=failed')
    expect(downloadSubpage('UNAVAILABLE')).toBe('/downloads/queue?filter=unavailable')
    expect(downloadSubpage('REJECTED')).toBe('/downloads/queue?filter=rejected')
    expect(downloadSubpage('PROMOTED')).toBe('/downloads/history')
    expect(downloadSubpage('INVALID')).toBe('/downloads/history')
  })

  it('defaults to the queue tab, downloading slice, for DOWNLOADING/ENRICHING/unknown/null', () => {
    expect(downloadSubpage('DOWNLOADING')).toBe('/downloads/queue?filter=downloading')
    expect(downloadSubpage('ENRICHING')).toBe('/downloads/queue?filter=downloading')
    expect(downloadSubpage(null)).toBe('/downloads/queue?filter=downloading')
    expect(downloadSubpage(undefined)).toBe('/downloads/queue?filter=downloading')
    expect(downloadSubpage('SOMETHING_ELSE')).toBe('/downloads/queue?filter=downloading')
  })

  it('points every filter it emits at a real Queue subtab', () => {
    const filters = ['failed', 'unavailable', 'rejected', 'downloading']
    filters.forEach(f => expect(queueFilters.some(q => q.key === f)).toBe(true))
  })
})

describe('download row capabilities', () => {
  it('lets failed, abandoned and unavailable rows be retried and rejected', () => {
    ;['FAILED', 'ABANDONED', 'UNAVAILABLE'].forEach((s) => {
      expect(canRetryDownload(s)).toBe(true)
      expect(canRejectDownload(s)).toBe(true)
      expect(canCancelDownload(s)).toBe(false)
      expect(canRequeueDownload(s)).toBe(false)
    })
  })

  it('offers cancel - never reject - while a row is still in flight', () => {
    ;['DOWNLOADING', 'ENRICHING'].forEach((s) => {
      expect(canCancelDownload(s)).toBe(true)
      expect(canRejectDownload(s)).toBe(false)
      expect(canRetryDownload(s)).toBe(false)
    })
  })

  it('offers only "move back to queue" on a rejected row', () => {
    expect(canRequeueDownload('REJECTED')).toBe(true)
    expect(canRetryDownload('REJECTED')).toBe(false)
    expect(canRejectDownload('REJECTED')).toBe(false)
    expect(canCancelDownload('REJECTED')).toBe(false)
  })

  it('gives a settled row no queue actions at all', () => {
    ;['PROMOTED', 'READY', 'INVALID'].forEach((s) => {
      expect(canRetryDownload(s)).toBe(false)
      expect(canRejectDownload(s)).toBe(false)
      expect(canCancelDownload(s)).toBe(false)
      expect(canRequeueDownload(s)).toBe(false)
    })
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

describe('pageCount', () => {
  it('returns 1 for an empty list so page 0 stays valid', () => {
    expect(pageCount(0, 15)).toBe(1)
  })

  it('rounds up partial pages', () => {
    expect(pageCount(15, 15)).toBe(1)
    expect(pageCount(16, 15)).toBe(2)
    expect(pageCount(50, 15)).toBe(4)
  })
})

describe('clampPage', () => {
  it('clamps below zero', () => {
    expect(clampPage(-3, 50, 15)).toBe(0)
  })

  it('clamps past the last page', () => {
    expect(clampPage(9, 50, 15)).toBe(3)
  })

  it('pulls the page back when the list shrinks', () => {
    expect(clampPage(3, 20, 15)).toBe(1)
    expect(clampPage(3, 0, 15)).toBe(0)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 50 }, (_, i) => i)

  it('slices the requested page', () => {
    expect(paginate(items, 0, 15)).toEqual(items.slice(0, 15))
    expect(paginate(items, 2, 15)).toEqual(items.slice(30, 45))
  })

  it('returns the short last page', () => {
    expect(paginate(items, 3, 15)).toEqual(items.slice(45))
  })

  it('clamps an out-of-range page instead of returning nothing', () => {
    expect(paginate(items, 99, 15)).toEqual(items.slice(45))
    expect(paginate(items, -1, 15)).toEqual(items.slice(0, 15))
  })

  it('handles an empty list', () => {
    expect(paginate([], 0, 15)).toEqual([])
  })
})

describe('musicBrainzUrl', () => {
  it('links a bound release to its release page', () => {
    expect(musicBrainzUrl({ musicbrainzId: 'rel-1', releaseGroupId: 'rg-1' }))
      .toBe('https://musicbrainz.org/release/rel-1')
  })

  // Catalogue gaps have no chosen release: sync stores the release-group MBID in both columns, and
  // /release/<group-id> 404s on musicbrainz.org.
  it('links a catalogue gap to its release-group page', () => {
    expect(musicBrainzUrl({ musicbrainzId: 'rg-1', releaseGroupId: 'rg-1' }))
      .toBe('https://musicbrainz.org/release-group/rg-1')
  })

  it('returns null when there is no MBID at all', () => {
    expect(musicBrainzUrl({ musicbrainzId: null, releaseGroupId: null })).toBeNull()
  })

  it('falls back to the release page when the group is unknown', () => {
    expect(musicBrainzUrl({ musicbrainzId: 'rel-1' })).toBe('https://musicbrainz.org/release/rel-1')
  })
})

describe('scanSessionName', () => {
  it('returns the bare prefix with no scope', () => {
    expect(scanSessionName('refresh')).toBe('refresh')
    expect(scanSessionName('refresh', '')).toBe('refresh')
  })

  it('slugifies the scope and appends it to the prefix', () => {
    expect(scanSessionName('refresh', 'Air Supply')).toBe('refresh-air-supply')
  })

  it('gives two different scopes different session names, so concurrent scoped runs of the same command do not collide', () => {
    expect(scanSessionName('check', 'Air Supply')).not.toBe(scanSessionName('check', 'Airbourne'))
  })

  it('strips characters SESSION_NAME_RE does not allow and collapses repeats', () => {
    expect(scanSessionName('refresh', 'Toto!! & Air/Supply')).toBe('refresh-toto-air-supply')
  })

  it('clamps to the 32-char SESSION_NAME_RE limit with no trailing dash', () => {
    const name = scanSessionName('refresh-release', 'cljk3x9z0000qzrmn831p7wq')
    expect(name.length).toBeLessThanOrEqual(32)
    expect(name.endsWith('-')).toBe(false)
  })
})

describe('toggleRowSelection', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('toggles a single row on a plain click', () => {
    const next = toggleRowSelection(ids, new Set(), 'b', { shiftKey: false }, null)
    expect(next).toEqual(new Set(['b']))
  })

  it('toggles a single row back off on a plain click', () => {
    const next = toggleRowSelection(ids, new Set(['b']), 'b', { shiftKey: false }, 'b')
    expect(next).toEqual(new Set())
  })

  it('selects the whole range between the anchor and the shift-clicked row', () => {
    const next = toggleRowSelection(ids, new Set(['b']), 'd', { shiftKey: true }, 'b')
    expect(next).toEqual(new Set(['b', 'c', 'd']))
  })

  it('selects the range regardless of click direction', () => {
    const next = toggleRowSelection(ids, new Set(['d']), 'b', { shiftKey: true }, 'd')
    expect(next).toEqual(new Set(['b', 'c', 'd']))
  })

  it('keeps existing selections outside the range untouched', () => {
    const next = toggleRowSelection(ids, new Set(['a', 'b']), 'd', { shiftKey: true }, 'b')
    expect(next).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('falls back to a plain toggle when there is no anchor yet', () => {
    const next = toggleRowSelection(ids, new Set(), 'c', { shiftKey: true }, null)
    expect(next).toEqual(new Set(['c']))
  })

  it('falls back to a plain toggle when the anchor row is no longer in the list', () => {
    const next = toggleRowSelection(ids, new Set(), 'c', { shiftKey: true }, 'z')
    expect(next).toEqual(new Set(['c']))
  })
})
