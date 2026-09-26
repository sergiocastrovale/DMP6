import type { PrismaClient } from '@prisma/client'
import type { RandomTrackRow } from '~/types/track'
import { sampleIds } from '~/server/utils/randomSample'

/**
 * `count` random tracks, sampled across the whole library (server/utils/randomSample.ts) - not the first
 * heap pages, which is all `TABLESAMPLE BERNOULLI ... LIMIT` ever returned. Returns fewer only when the
 * library itself has fewer.
 */
export async function fetchRandomTrackRows(prisma: PrismaClient, count: number): Promise<RandomTrackRow[]> {
  const ids = await sampleIds(prisma, 'LocalReleaseTrack', count)
  if (ids.length === 0) {
    return []
  }
  const rows = await prisma.$queryRaw<RandomTrackRow[]>`
    SELECT id, title, artist, album, duration, "localReleaseId"
    FROM "LocalReleaseTrack"
    WHERE id = ANY(${ids}::text[])`
  // ANY() returns in heap order; put the shuffle back.
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.flatMap(id => byId.get(id) ?? [])
}
