// Plays are per-user and private (CLAUDE.md Data Model, LocalReleaseTrackPlay) - one counter row
// per (user, track), same pattern as FavoriteTrack. Release/artist totals and "last played" are
// never stored denormalized; they're computed from this table at read time, here.

import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import type { PlayPeriod } from '~/types/stats'
import { DEFAULT_TIME_ZONE, zonedDate, zonedMidnight } from '~/server/utils/timezone'

// `db` is the transaction client when the caller needs the increment to commit with other writes
// (server/utils/playEvents.ts flips PlayEvent.counted and increments in one transaction).
export const recordPlay = async (userId: number, trackId: string, playedAt: Date, db: Prisma.TransactionClient = prisma) => {
  await db.localReleaseTrackPlay.upsert({
    where: { userId_trackId: { userId, trackId } },
    create: { userId, trackId, playCount: 1, lastPlayedAt: playedAt },
    update: { playCount: { increment: 1 }, lastPlayedAt: playedAt },
  })
}

export interface TrackPlayStats {
  playCount: number
  lastPlayedAt: Date | null
}

const EMPTY_TRACK_PLAY: TrackPlayStats = { playCount: 0, lastPlayedAt: null }

export const trackPlaysByIds = async (userId: number, trackIds: string[]): Promise<Map<string, TrackPlayStats>> => {
  if (trackIds.length === 0) {return new Map()}
  const rows = await prisma.localReleaseTrackPlay.findMany({
    where: { userId, trackId: { in: trackIds } },
    select: { trackId: true, playCount: true, lastPlayedAt: true },
  })
  return new Map(rows.map(r => [r.trackId, { playCount: r.playCount, lastPlayedAt: r.lastPlayedAt }]))
}

// Merges a track's per-user play stats into an already-selected row - default 0/null when the
// user has never played it. Keeps route selects/response shapes unchanged.
export const withTrackPlay = <T extends { id: string }>(row: T, plays: Map<string, TrackPlayStats>): T & TrackPlayStats => ({
  ...row,
  ...(plays.get(row.id) ?? EMPTY_TRACK_PLAY),
})

export interface ReleasePlayStats {
  totalPlayCount: number
  lastPlayedAt: Date | null
}


export const releasePlayTotals = async (userId: number, releaseIds: string[]): Promise<Map<string, ReleasePlayStats>> => {
  if (releaseIds.length === 0) {return new Map()}
  const rows = await prisma.$queryRaw<{ localReleaseId: string, totalPlayCount: bigint, lastPlayedAt: Date }[]>`
    SELECT lrt."localReleaseId" AS "localReleaseId",
           SUM(p."playCount")::bigint AS "totalPlayCount",
           MAX(p."lastPlayedAt") AS "lastPlayedAt"
    FROM "LocalReleaseTrackPlay" p
    JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
    WHERE p."userId" = ${userId} AND lrt."localReleaseId" = ANY(${releaseIds}::text[])
    GROUP BY lrt."localReleaseId"
  `
  return new Map(rows.map(r => [r.localReleaseId, { totalPlayCount: Number(r.totalPlayCount), lastPlayedAt: r.lastPlayedAt }]))
}

// Credits every owning artist (LocalReleaseArtist), same as the old per-owner increment on play.
export const artistPlayTotals = async (userId: number, artistIds: string[]): Promise<Map<string, number>> => {
  if (artistIds.length === 0) {return new Map()}
  const rows = await prisma.$queryRaw<{ artistId: string, totalPlayCount: bigint }[]>`
    SELECT lra."artistId" AS "artistId", SUM(p."playCount")::bigint AS "totalPlayCount"
    FROM "LocalReleaseTrackPlay" p
    JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
    WHERE p."userId" = ${userId} AND lra."artistId" = ANY(${artistIds}::text[])
    GROUP BY lra."artistId"
  `
  return new Map(rows.map(r => [r.artistId, Number(r.totalPlayCount)]))
}

export const userTotalPlays = async (userId: number): Promise<number> => {
  const result = await prisma.localReleaseTrackPlay.aggregate({
    where: { userId },
    _sum: { playCount: true },
  })
  return result._sum.playCount ?? 0
}

// Statistics → Recent Plays panel (helpers/constants.ts's playPeriods) and its detail subpage
// (pages/statistics/recent-plays/[period].vue) - the one place "today"/"week"/"month"/"year" turn
// into an actual boundary, shared by the tile counts and the filtered list so they never disagree.
// "week" is a trailing 7-day window (not the current calendar week); the rest are calendar-boundary,
// to-date, in the listener's `timeZone` (the client reports it; UTC when it doesn't). `now` is a parameter
// (not `new Date()` inline) so it's pure and unit-testable.
export const periodStart = (period: PlayPeriod, now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): Date => {
  const { year, month, day } = zonedDate(now, timeZone)
  switch (period) {
    case 'today': return zonedMidnight(year, month, day, timeZone)
    case 'week': return new Date(now.getTime() - 7 * 86400000)
    case 'month': return zonedMidnight(year, month, 1, timeZone)
    case 'year': return zonedMidnight(year, 1, 1, timeZone)
  }
}

// Counted plays (PlayEvent.counted - the same "meaningfully listened to" threshold LocalReleaseTrackPlay
// itself increments on) starting in each period, for the index page's Recent Plays tiles.
export const recentPlayCounts = async (userId: number, timeZone: string = DEFAULT_TIME_ZONE): Promise<Record<PlayPeriod, number>> => {
  const now = new Date()
  const start = {
    today: periodStart('today', now, timeZone),
    week: periodStart('week', now, timeZone),
    month: periodStart('month', now, timeZone),
    year: periodStart('year', now, timeZone),
  }
  // One pass over the user's recent counted plays instead of four separate counts. The scan is bounded by the earliest
  // boundary (the year start, or the week window in early January), and each period is a FILTERed count over it.
  const earliest = new Date(Math.min(...Object.values(start).map(d => d.getTime())))
  const [row] = await prisma.$queryRaw<{ today: number, week: number, month: number, year: number }[]>`
    SELECT
      count(*) FILTER (WHERE "startedAt" >= ${start.today})::int AS today,
      count(*) FILTER (WHERE "startedAt" >= ${start.week})::int AS week,
      count(*) FILTER (WHERE "startedAt" >= ${start.month})::int AS month,
      count(*) FILTER (WHERE "startedAt" >= ${start.year})::int AS year
    FROM "PlayEvent"
    WHERE "userId" = ${userId} AND counted = true AND "startedAt" >= ${earliest}`
  return { today: row?.today ?? 0, week: row?.week ?? 0, month: row?.month ?? 0, year: row?.year ?? 0 }
}

const RECENT_SKIP_WINDOW_DAYS = 90

// Skips in the last 90 days per track (PlayEvent.skipped) - feeds Explore's familiarity skip penalty
// (server/utils/explore.ts's scoreFamiliarity). A `finish` (page unload) is never counted as a skip
// (composables/usePlayEventTracker.ts), so this only reflects deliberate track changes/dismissals.
export const recentSkipsByIds = async (userId: number, trackIds: string[]): Promise<Map<string, number>> => {
  if (trackIds.length === 0) {return new Map()}
  const since = new Date(Date.now() - RECENT_SKIP_WINDOW_DAYS * 86400000)
  const rows = await prisma.playEvent.groupBy({
    by: ['trackId'],
    where: { userId, trackId: { in: trackIds }, skipped: true, startedAt: { gte: since } },
    _count: { _all: true },
  })
  return new Map(rows.map(r => [r.trackId, r._count._all]))
}
