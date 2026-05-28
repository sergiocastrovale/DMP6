import type { DecadeStats } from '~/types/labs'

interface DecadeRow {
  decade: number
  release_count: bigint
  track_count: bigint
  artist_count: bigint
  avg_duration: number | null
  avg_bitrate: number | null
  total_play_count: bigint
}

interface GenreRow {
  decade: number
  genre: string
  cnt: bigint
}

export default defineEventHandler(async (): Promise<DecadeStats[]> => {
  const rows = await prisma.$queryRaw<DecadeRow[]>`
    SELECT
      (FLOOR(lr.year / 10) * 10)::int AS decade,
      COUNT(DISTINCT lr.id) AS release_count,
      COUNT(DISTINCT lrt.id) AS track_count,
      COUNT(DISTINCT lra."artistId") AS artist_count,
      AVG(lrt.duration)::float AS avg_duration,
      AVG(lrt.bitrate)::float AS avg_bitrate,
      COALESCE(SUM(lrt."playCount"), 0) AS total_play_count
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
    LEFT JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
    WHERE lr.year IS NOT NULL
    GROUP BY decade
    ORDER BY decade
  `

  const genreRows = await prisma.$queryRaw<GenreRow[]>`
    SELECT
      (FLOOR(lr.year / 10) * 10)::int AS decade,
      lrt.genre,
      COUNT(*) AS cnt
    FROM "LocalRelease" lr
    JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
    WHERE lr.year IS NOT NULL AND lrt.genre IS NOT NULL AND lrt.genre != ''
    GROUP BY decade, lrt.genre
    ORDER BY decade, cnt DESC
  `

  const genresByDecade = new Map<number, Map<string, number>>()
  for (const row of genreRows) {
    if (!genresByDecade.has(row.decade)) {
      genresByDecade.set(row.decade, new Map())
    }
    const genres = row.genre.split(/[;,/]/).map((g) => g.trim().toLowerCase()).filter(Boolean)
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
      totalPlayCount: Number(row.total_play_count),
    }
  })
})
