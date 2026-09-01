import type { DownloadedReleaseItem } from '~/types/download'
import type { ScanProgress } from '~/types/scan'
import type { SortDirection } from '~/types/common'

// Scan the terminal output backwards for the latest structured `PROGRESS:{json}` line emitted by the
// index/sync/refresh scripts (--web mode). Returns null when no structured progress is present.
export const parseProgress = (lines: string[]): ScanProgress | null => {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (typeof line === 'string' && line.startsWith('PROGRESS:')) {
      try {
        return JSON.parse(line.slice(9))
      }
      catch { /* ignore malformed */ }
    }
  }
  return null
}

// Reads the "dropped links" warning ./index emits when tracks whose files disappeared took favorites
// or playlist entries with them (dropped_links_line in scripts/index/src/deletion.rs - keep both in
// sync). Replacing a file under a NEW name is a new track row, so the old row's links cascade away;
// they are reported, never re-linked.
export const parseDroppedLinks = (lines: string[]): { favorites: number, playlists: number } | null => {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (typeof line !== 'string') {
      continue
    }
    const match = /WARN: dropped (\d+) favourite\(s\) and (\d+) playlist entry\(ies\)/.exec(line)
    if (match) {
      return { favorites: Number(match[1]), playlists: Number(match[2]) }
    }
  }
  return null
}

export const filterQueue = (items: DownloadedReleaseItem[], query: string): DownloadedReleaseItem[] => {
  const q = query.trim().toLowerCase()
  if (!q) {
    return items
  }
  return items.filter(i =>
    (i.artist ?? '').toLowerCase().includes(q)
    || i.title.toLowerCase().includes(q)
    || String(i.year ?? '').includes(q),
  )
}

// Generic client-side sort: nulls always sink to the bottom, numbers compare numerically, everything
// else by locale string. Returns a new array (never mutates the input).
export const sortItems = <T>(items: T[], accessor: (item: T) => string | number | null | undefined, dir: SortDirection): T[] => {
  const out = [...items].sort((a, b) => {
    const av = accessor(a)
    const bv = accessor(b)
    if (av == null && bv == null) {
      return 0
    }
    if (av == null) {
      return 1
    }
    if (bv == null) {
      return -1
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return av - bv
    }
    return String(av).localeCompare(String(bv))
  })
  return dir === 'desc' ? out.reverse() : out
}

// Maps a release's download state to the /downloads subpage that lists it (for "Verify download").
export const downloadSubpage = (state?: string | null): string => {
  switch (state) {
    case 'READY':
      return '/downloads/merge'
    case 'FAILED':
    case 'ABANDONED':
      return '/downloads/failed'
    case 'UNAVAILABLE':
      return '/downloads/unavailable'
    case 'PROMOTED':
    case 'REJECTED':
    case 'INVALID':
      return '/downloads/history'
    default:
      return '/downloads/downloading'
  }
}

export const formatDuration = (seconds: number | null): string => {
  if (!seconds || !isFinite(seconds)) { return '0:00' }
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const formatPlaytime = (seconds: number): string => {
  if (seconds === 0) { return '0 seconds' }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const years = Math.floor(seconds / 31536000)
  const remaining = seconds % 31536000
  const months = Math.floor(remaining / 2592000)
  const days = Math.floor((remaining % 2592000) / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const parts: string[] = []
  if (years > 0) { parts.push(plural(years, 'year')) }
  if (months > 0) { parts.push(plural(months, 'month')) }
  if (days > 0) { parts.push(plural(days, 'day')) }
  if (hours > 0) { parts.push(plural(hours, 'hour')) }
  if (mins > 0) { parts.push(plural(mins, 'minute')) }
  return parts.join(', ') || '< 1 minute'
}

export const formatNumber = (n: number): string => {
  return n.toLocaleString()
}

export const formatDate = (iso: string | null): string => {
  if (!iso) { return 'Never' }
  return new Date(iso).toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Compact "x ago" relative time for recent events ("just now", "5m ago", "3h ago", "2d ago").
export const timeAgo = (iso: string | null): string => {
  if (!iso) { return '' }
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) { return 'just now' }
  const mins = Math.floor(secs / 60)
  if (mins < 60) { return `${mins}m ago` }
  const hours = Math.floor(mins / 60)
  if (hours < 24) { return `${hours}h ago` }
  return `${Math.floor(hours / 24)}d ago`
}

export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) { return '0 B' }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

export const formatSpeed = (bytesPerSec: number): string => {
  if (!bytesPerSec) { return '' }
  if (bytesPerSec >= 1_048_576) { return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s` }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
}

// Number of pages needed to show `total` items `size` at a time. Always at least 1, so an empty
// list still has a valid page 0 to render.
export const pageCount = (total: number, size: number): number =>
  total <= 0 || size <= 0 ? 1 : Math.ceil(total / size)

// Clamp a page index into [0, pageCount - 1]. Used when the underlying list shrinks under a page
// the user is currently sitting on.
export const clampPage = (page: number, total: number, size: number): number =>
  Math.min(Math.max(page, 0), pageCount(total, size) - 1)

// Slice of `items` for a zero-based page index. Out-of-range pages are clamped rather than
// returning an empty slice.
export const paginate = <T>(items: T[], page: number, size: number): T[] => {
  if (size <= 0) { return items }
  const start = clampPage(page, items.length, size) * size
  return items.slice(start, start + size)
}

// MusicBrainz link for a release row. A catalogue gap (status MISSING) has no chosen release - sync
// creates the placeholder from the release *group*, storing that group's MBID in both columns - so
// linking it as /release/<id> 404s. Anything with a real release id keeps the /release/ URL.
export const musicBrainzUrl = (release: { musicbrainzId: string | null, releaseGroupId?: string | null }): string | null => {
  if (!release.musicbrainzId) {
    return null
  }
  const isGroupPlaceholder = release.releaseGroupId === release.musicbrainzId
  return `https://musicbrainz.org/${isGroupPlaceholder ? 'release-group' : 'release'}/${release.musicbrainzId}`
}

// With no explicit session, the terminal store's `run()` falls back to a fixed `dmp-<command>` name
// shared by every caller of that command - two artists' `./index` runs land on the same `dmp-index`
// session and the second hits the 409 hasUnfinishedRun guard. Scoping the session to what's being
// scanned keeps concurrent scoped runs of the same command apart. Must satisfy SESSION_NAME_RE
// (/^[a-zA-Z0-9_-]{1,32}$/) in server/utils/terminalCommand.ts.
export const scanSessionName = (prefix: string, scope?: string): string => {
  const slug = (scope ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `${prefix}-${slug}`.slice(0, 32).replace(/-+$/, '') : prefix
}
