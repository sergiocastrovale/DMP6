import type { PrismaClient } from '@prisma/client'
import type { RandomTrackRow } from '~/types/track'

/**
 * Random track sampling with an escalating fallback: BERNOULLI(0.05) is cheap but can come up short on
 * a small library; BERNOULLI(1) is a wider net for the same reason. Neither is guaranteed to return
 * `count` rows (TABLESAMPLE is probabilistic, not "top N"), so a final plain `ORDER BY random() LIMIT n`
 * closes the gap whenever the library actually has at least `count` tracks.
 */
export async function fetchRandomTrackRows(prisma: PrismaClient, count: number): Promise<RandomTrackRow[]> {
  let rows = await prisma.$queryRaw<RandomTrackRow[]>`
    SELECT id, title, artist, album, duration, "localReleaseId"
    FROM "LocalReleaseTrack"
    TABLESAMPLE BERNOULLI(0.05)
    LIMIT ${count}
  `

  if (rows.length < count) {
    rows = await prisma.$queryRaw<RandomTrackRow[]>`
      SELECT id, title, artist, album, duration, "localReleaseId"
      FROM "LocalReleaseTrack"
      TABLESAMPLE BERNOULLI(1)
      LIMIT ${count}
    `
  }

  if (rows.length < count) {
    rows = await prisma.$queryRaw<RandomTrackRow[]>`
      SELECT id, title, artist, album, duration, "localReleaseId"
      FROM "LocalReleaseTrack"
      ORDER BY random()
      LIMIT ${count}
    `
  }

  return rows
}
