import type { SearchResults } from '~/types/search'
import { hydrateArtists, hydrateReleases, hydrateTracks, rankedArtistIds, rankedReleaseIds, rankedTrackIds } from '~/server/utils/searchRank'

const DROPDOWN_TAKE = 6

export default defineEventHandler(async (event): Promise<SearchResults> => {
  const query = getQuery(event)
  const searchQuery = query.q as string

  if (!searchQuery || searchQuery.length < 2) {
    return {
      artists: [],
      releases: [],
      tracks: [],
      counts: { artists: 0, releases: 0, tracks: 0 },
    }
  }

  const [artistIds, releaseIds, trackIds] = await Promise.all([
    rankedArtistIds(searchQuery, 0, DROPDOWN_TAKE),
    rankedReleaseIds(searchQuery, 0, DROPDOWN_TAKE),
    rankedTrackIds(searchQuery, 0, DROPDOWN_TAKE),
  ])

  const [artists, releases, tracks] = await Promise.all([
    hydrateArtists(artistIds.ids),
    hydrateReleases(releaseIds.ids),
    hydrateTracks(trackIds.ids),
  ])

  return {
    artists,
    releases,
    tracks,
    counts: {
      artists: artistIds.total,
      releases: releaseIds.total,
      tracks: trackIds.total,
    },
  }
})
