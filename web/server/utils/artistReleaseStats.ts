// Pure aggregation extracted from server/api/artists/index.get.ts. `Artist.releases` relates via the
// many-to-many `LocalReleaseArtist` join, not a direct FK, so per-artist release count and
// completeness can't come from a single `_count`/`orderBy` at the DB level - the route runs one
// follow-up query scoped to the current page's artist ids and merges the result in JS via this module.

export interface ArtistReleaseLink {
  artistId: string
  localRelease: { id: string, matchStatus: string }
}

export interface ReleaseStatsResult {
  releaseCount: number
  completeCount: number
}

// Dedupes by localRelease.id within each artist - a compilation ties the same release to multiple
// co-owners, and without the dedupe a shared release would inflate one owner's own releaseCount if the
// join ever produced more than one row per (artistId, releaseId) pair.
export function computeReleaseStats(links: ArtistReleaseLink[]): Map<string, ReleaseStatsResult> {
  const byArtist = new Map<string, Map<string, string>>()
  for (const link of links) {
    let releases = byArtist.get(link.artistId)
    if (!releases) {
      releases = new Map()
      byArtist.set(link.artistId, releases)
    }
    releases.set(link.localRelease.id, link.localRelease.matchStatus)
  }

  const result = new Map<string, ReleaseStatsResult>()
  for (const [artistId, releases] of byArtist) {
    const completeCount = [...releases.values()].filter(matchStatus => matchStatus === 'COMPLETE').length
    result.set(artistId, { releaseCount: releases.size, completeCount })
  }
  return result
}

export function mergeReleaseStats<T extends { id: string }>(
  items: T[],
  links: ArtistReleaseLink[],
): (T & ReleaseStatsResult)[] {
  const stats = computeReleaseStats(links)
  return items.map(item => ({
    ...item,
    ...(stats.get(item.id) ?? { releaseCount: 0, completeCount: 0 }),
  }))
}

// `releases`/`completeness` have no DB column to `orderBy` - the route leaves the DB query at its
// default order and sorts the already-merged page in JS instead. Undefined releaseCount (no releases)
// sorts a completeness fraction of 0, not last-by-NaN.
export function sortArtistsInMemory<T extends ReleaseStatsResult>(
  items: T[],
  sort: string,
  direction: 'asc' | 'desc' = 'desc',
): T[] {
  const key = sort === 'releases'
    ? (item: T) => item.releaseCount
    : sort === 'completeness'
      ? (item: T) => (item.releaseCount === 0 ? 0 : item.completeCount / item.releaseCount)
      : null

  if (!key) {
    return items
  }

  const sign = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => (key(a) - key(b)) * sign)
}
