import type { DownloadedReleaseItem } from '~/types/download'
import type { ScanProgress } from '~/types/scan'
import type { SortDirection } from '~/types/common'

// Whether a caught $fetch error is only "a newer request superseded this one" (AbortController.abort()
// on a stale in-flight call - the standard "abort the old request when a fresher one starts" pattern
// used by browse.ts's fetchArtists and FiltersGenre.vue's fetchGenres) rather than a real failure that
// should propagate. `ofetch` wraps an aborted request in its own `FetchError`, whose `.name` is
// 'FetchError' - the actual `AbortError` lives one level down at `.cause` - so checking `e.name`
// alone (the fetch spec's own contract for a plain aborted `fetch()`) never matches an ofetch/$fetch
// abort, and the wrapped error was re-thrown as an unhandled rejection on every single one.
export const isAbortError = (e: unknown): boolean => {
  const err = e as { name?: string, cause?: { name?: string } } | null | undefined
  return err?.name === 'AbortError' || err?.cause?.name === 'AbortError'
}

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

// What a queue row can be acted on, by status. Downloading, failed, unavailable and rejected share one
// tab, so the row/bulk actions are derived from the status instead of from which page you are on.
// REJECTED rows are moved back to the queue rather than rejected again; an in-flight row is cancelled
// rather than rejected (rejecting mid-transfer would leave the staging folder behind).
export const canRetryDownload = (status: string): boolean =>
  status === 'FAILED' || status === 'ABANDONED' || status === 'UNAVAILABLE'

export const canCancelDownload = (status: string): boolean =>
  status === 'DOWNLOADING' || status === 'ENRICHING' || status === 'SEARCHING'

export const canRequeueDownload = (status: string): boolean => status === 'REJECTED'

export const canRejectDownload = (status: string): boolean => canRetryDownload(status)

// Maps a release's download state to the /downloads subpage that lists it (for "Verify download").
// The active/failed/unavailable/rejected slices all live on the one Queue tab, pre-filtered by ?filter.
export const downloadSubpage = (state?: string | null): string => {
  switch (state) {
    case 'READY':
      return '/downloads/merge'
    case 'FAILED':
    case 'ABANDONED':
      return '/downloads/queue?filter=failed'
    case 'UNAVAILABLE':
      return '/downloads/queue?filter=unavailable'
    case 'REJECTED':
      return '/downloads/queue?filter=rejected'
    case 'PROMOTED':
    case 'INVALID':
      return '/downloads/history'
    default:
      return '/downloads/queue?filter=downloading'
  }
}

export const formatRelative = (date: string): string => {
  const ms = Date.now() - new Date(date).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) { return 'Just now' }
  if (min < 60) { return `${min}m ago` }
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago` 
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

export const musicbrainzArtistUrl = (mbid: string): string => `https://musicbrainz.org/artist/${mbid}`

// With no explicit session, the terminal store's `run()` falls back to a fixed `dmp-<command>` name
// shared by every caller of that command - two artists' `./index` runs land on the same `dmp-index`
// session and the second hits the 409 hasUnfinishedRun guard. Scoping the session to what's being
// scanned keeps concurrent scoped runs of the same command apart. Must satisfy SESSION_NAME_RE
// (/^[a-zA-Z0-9_-]{1,32}$/) in server/utils/terminalCommand.ts.
export const scanSessionName = (prefix: string, scope?: string): string => {
  const slug = (scope ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `${prefix}-${slug}`.slice(0, 32).replace(/-+$/, '') : prefix
}

// Shift-click range select / ctrl-click independent toggle for row checkboxes, mirroring the
// selection UX of native file managers and Gmail-style tables. `anchorId` is the last row a plain
// or shift click landed on; shift-click selects every row between there and `id` (never
// deselects), ctrl/meta-click and a plain click both just flip `id` alone.
export const toggleRowSelection = <T extends string | number>(
  ids: T[],
  selected: Set<T>,
  id: T,
  event: { shiftKey: boolean },
  anchorId: T | null,
): Set<T> => {
  const next = new Set(selected)
  if (event.shiftKey && anchorId !== null) {
    const from = ids.indexOf(anchorId)
    const to = ids.indexOf(id)
    if (from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from]
      for (let i = start; i <= end; i++) {
        next.add(ids[i]!)
      }
      return next
    }
  }
  next.has(id) ? next.delete(id) : next.add(id)
  return next
}

// A MISSING gap's `statusReason` can carry the containment note sync writes when every one of the
// release's tracks already sits inside a bigger local release - a box set, a compilation, a two-disc
// folder (scripts/sync/src/owned.rs). Holding that container is NOT holding this release, so the row
// stays a gap; the note only says where those recordings can already be heard. Returns the container's
// title, or null when the reason is anything else.
export const containmentContainerTitle = (statusReason?: string | null): string | null =>
  statusReason?.match(/^Recordings inside "(.+)"$/)?.[1] ?? null

// Short "Browser · OS" device label for Settings → Users' "connected now" panel
// (server/utils/presence.ts). No UA-parser dependency for a one-line admin-only label - order
// matters (Edge/Chrome UAs both contain "Safari", most contain "Mobile" too), so check the most
// specific token first.
export const describeUserAgent = (ua: string | null | undefined): string => {
  if (!ua) {return 'Unknown device'}
  const browser = ua.includes('Edg/') ? 'Edge'
    : ua.includes('OPR/') || ua.includes('Opera') ? 'Opera'
    : ua.includes('Firefox/') ? 'Firefox'
    : ua.includes('CriOS/') ? 'Chrome'
    : ua.includes('Chrome/') ? 'Chrome'
    : ua.includes('FxiOS/') ? 'Firefox'
    : ua.includes('Safari/') ? 'Safari'
    : 'Browser'
  const os = ua.includes('Android') ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac OS X') ? 'macOS'
    : ua.includes('Linux') ? 'Linux'
    : null
  return os ? `${browser} · ${os}` : browser
}

// Integer from an environment variable, or `fallback` when it is unset or not a number.
export const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  const n = raw != null ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n : fallback
}

// The browser's IANA time zone ("Europe/Lisbon"); the server resolves "today/month/year" boundaries in it.
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

// The message of anything that was thrown: an Error's, the `message` of an error-like object (h3's createError result,
// a Prisma error), else the value itself as text.
export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) {return e.message}
  const message = (e as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(e)
}

// The `code` of a thrown error (a Node errno like 'EXDEV', a Prisma code like 'P2002'), or undefined.
export const errorCode = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

// A mosaic file's size: whole KB below a megabyte, one-decimal MB above.
export const formatMosaicSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`
