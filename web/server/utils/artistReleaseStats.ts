// Attaches per-artist release counts (server/utils/artistList.ts releaseCountsByArtist) onto browse rows.
// `Artist.releases` relates via the many-to-many `LocalReleaseArtist` join, not a direct FK, so the count
// can't come from a single `_count` at the DB level - the route runs one grouped follow-up query scoped to
// the current page's artist ids.
import type { ReleaseStatsResult } from '~/types/artist'

export const withReleaseCounts = <T extends { id: string }>(
  items: T[],
  counts: Map<string, number>,
): (T & ReleaseStatsResult)[] => {
  return items.map(item => ({ ...item, releaseCount: counts.get(item.id) ?? 0 }))
}
