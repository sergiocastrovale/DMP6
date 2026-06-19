import type { DownloadedReleaseItem } from '~/types/download'
import type { ScanProgress } from '~/types/scan'

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

export type SortDir = 'asc' | 'desc'

// Generic client-side sort: nulls always sink to the bottom, numbers compare numerically, everything
// else by locale string. Returns a new array (never mutates the input).
export const sortItems = <T>(items: T[], accessor: (item: T) => string | number | null | undefined, dir: SortDir): T[] => {
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
