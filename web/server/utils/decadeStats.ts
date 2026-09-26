import type { Db } from '~/server/utils/statementTimeout'
import type { DecadeRow, DecadeStats, GenreRow } from '~/types/labs'

// Labs → Decade DNA. Split in two on purpose:
//   - decadeAggregates: everything derived from the library alone - three COUNT(DISTINCT) over a
//     LocalRelease x LocalReleaseTrack x LocalReleaseArtist join plus a GROUP BY genre over 1.9M tracks. Heavy, the
//     same for every user, and only changes when a scan runs, so it is cached (library-versioned).
//   - decadePlayTotals: this user's plays per decade, a small aggregate over their own LocalReleaseTrackPlay rows.
// The old single query LEFT JOINed LocalReleaseArtist and LocalReleaseTrackPlay together, so a release with two
// owners counted each play twice. The play total is now one row per play.
export type DecadeAggregate = Omit<DecadeStats, 'totalPlayCount'>

export const decadeAggregates = async (prisma: Db): Promise<DecadeAggregate[]> => {
  const [rows, genreRows] = await Promise.all([
    prisma.$queryRaw<Omit<DecadeRow, 'total_play_count'>[]>`
      SELECT
        (FLOOR(lr.year / 10) * 10)::int AS decade,
        COUNT(DISTINCT lr.id) AS release_count,
        COUNT(DISTINCT lrt.id) AS track_count,
        COUNT(DISTINCT lra."artistId") AS artist_count,
        AVG(lrt.duration)::float AS avg_duration,
        AVG(lrt.bitrate)::float AS avg_bitrate
      FROM "LocalRelease" lr
      JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
      LEFT JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
      WHERE lr.year IS NOT NULL
      GROUP BY decade
      ORDER BY decade
    `,
    prisma.$queryRaw<GenreRow[]>`
      SELECT
        (FLOOR(lr.year / 10) * 10)::int AS decade,
        lrt.genre,
        COUNT(*) AS cnt
      FROM "LocalRelease" lr
      JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
      WHERE lr.year IS NOT NULL AND lrt.genre IS NOT NULL AND lrt.genre != ''
      GROUP BY decade, lrt.genre
      ORDER BY decade, cnt DESC
    `,
  ])

  const genresByDecade = new Map<number, Map<string, number>>()
  for (const row of genreRows) {
    if (!genresByDecade.has(row.decade)) {
      genresByDecade.set(row.decade, new Map())
    }
    const genres = row.genre.split(/[;,/]/).map(g => g.trim().toLowerCase()).filter(Boolean)
    const decadeGenres = genresByDecade.get(row.decade)!
    for (const genre of genres) {
      decadeGenres.set(genre, (decadeGenres.get(genre) || 0) + Number(row.cnt))
    }
  }

  return rows.map((row) => {
    const decadeGenres = genresByDecade.get(row.decade)
    const topGenres = decadeGenres
      ? [...decadeGenres.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, count]) => ({ name, count }))
      : []
    return {
      decade: `${row.decade}s`,
      releaseCount: Number(row.release_count),
      trackCount: Number(row.track_count),
      artistCount: Number(row.artist_count),
      avgDuration: Math.round(row.avg_duration || 0),
      avgBitrate: Math.round(row.avg_bitrate || 0),
      topGenres,
    }
  })
}

// Plays per decade for one user, keyed by the decade's label ("1990s").
export const decadePlayTotals = async (prisma: Db, userId: number): Promise<Map<string, number>> => {
  const rows = await prisma.$queryRaw<{ decade: number, plays: bigint }[]>`
    SELECT (FLOOR(lr.year / 10) * 10)::int AS decade, SUM(p."playCount")::bigint AS plays
    FROM "LocalReleaseTrackPlay" p
    JOIN "LocalReleaseTrack" t ON t.id = p."trackId"
    JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
    WHERE p."userId" = ${userId} AND lr.year IS NOT NULL
    GROUP BY decade`
  return new Map(rows.map(r => [`${r.decade}s`, Number(r.plays)]))
}

export const withPlayTotals = (aggregates: DecadeAggregate[], plays: Map<string, number>): DecadeStats[] =>
  aggregates.map(a => ({ ...a, totalPlayCount: plays.get(a.decade) ?? 0 }))
