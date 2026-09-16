// Plays are per-user and private (CLAUDE.md Data Model, LocalReleaseTrackPlay) - one counter row
// per (user, track), same pattern as FavoriteTrack. Release/artist totals and "last played" are
// never stored denormalized; they're computed from this table at read time, here.

import { prisma } from './prisma'

export const recordPlay = async (userId: number, trackId: string, playedAt: Date) => {
  await prisma.localReleaseTrackPlay.upsert({
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

const EMPTY_RELEASE_PLAY: ReleasePlayStats = { totalPlayCount: 0, lastPlayedAt: null }

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

export const withReleasePlay = <T extends { id: string }>(row: T, plays: Map<string, ReleasePlayStats>): T & ReleasePlayStats => ({
  ...row,
  ...(plays.get(row.id) ?? EMPTY_RELEASE_PLAY),
})

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
