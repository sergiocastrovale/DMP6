import type { DecadeStats } from '~/types/labs'

export const RADAR_LABELS = ['Releases', 'Tracks', 'Artists', 'Avg Length', 'Avg Bitrate', 'Total Plays'] as const

// One ramp per selectable decade slot, in this order.
export const SERIES_TOKENS = ['amber-400', 'green-500', 'orange-400', 'red-400', 'violet-400'] as const
// The same five as literal utilities for the breakdown dots and the legend. They have to be written out rather than
// interpolated: Tailwind scans source text, so `bg-${token}` produces no class.
export const SERIES_DOTS = ['bg-amber-400', 'bg-green-500', 'bg-orange-400', 'bg-red-400', 'bg-violet-400'] as const

export const normalize = (value: number, max: number): number => (max > 0 ? (value / max) * 100 : 0)

// The radar axes of one decade, each scaled to 0-100 against the strongest decade in the library.
export const radarValues = (decade: DecadeStats, all: DecadeStats[]): number[] => {
  const max = (pick: (d: DecadeStats) => number) => Math.max(...all.map(pick))
  return [
    normalize(decade.releaseCount, max(d => d.releaseCount)),
    normalize(decade.trackCount, max(d => d.trackCount)),
    normalize(decade.artistCount, max(d => d.artistCount)),
    normalize(decade.avgDuration, max(d => d.avgDuration)),
    normalize(decade.avgBitrate, max(d => d.avgBitrate)),
    normalize(decade.totalPlayCount, max(d => d.totalPlayCount)),
  ]
}

// The unscaled values behind each axis, for the tooltip.
export const radarRawValues = (decade: DecadeStats): (number | string)[] => [
  decade.releaseCount,
  decade.trackCount,
  decade.artistCount,
  `${Math.round(decade.avgDuration / 1000)}s`,
  `${decade.avgBitrate} kbps`,
  decade.totalPlayCount,
]

// Milliseconds as m:ss.
export const formatDecadeDuration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// The three biggest decades (by releases) - what the page selects first.
export const defaultSelection = (decades: DecadeStats[], count = 3): string[] =>
  [...decades].sort((a, b) => b.releaseCount - a.releaseCount).slice(0, count).map(d => d.decade)
