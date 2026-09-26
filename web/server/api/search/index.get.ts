import type { SearchResults } from '~/types/search'
import { SEARCH_MIN_CHARS } from '~/helpers/constants'
import { hydrateArtists, hydrateReleases, hydrateTracks, rankedArtistIds, rankedReleaseIds, rankedTrackIds } from '~/server/utils/searchRank'

const DROPDOWN_TAKE = 6

export default defineEventHandler(async (event): Promise<SearchResults> => {
  const query = getQuery(event)
  const searchQuery = typeof query.q === 'string' ? query.q.trim() : ''

  if (searchQuery.length < SEARCH_MIN_CHARS.artists) {
    return {
      artists: [],
      releases: [],
      tracks: [],
      counts: { artists: 0, releases: 0, tracks: 0 },
      countsCapped: { artists: false, releases: false, tracks: false },
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
    countsCapped: {
      artists: artistIds.totalCapped,
      releases: releaseIds.totalCapped,
      tracks: trackIds.totalCapped,
    },
  }
})
