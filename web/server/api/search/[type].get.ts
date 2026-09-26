import { SEARCH_MIN_CHARS } from '~/helpers/constants'
import { paged, parsePagination } from '~/server/utils/pagination'
import { hydrateArtists, hydrateReleases, hydrateTracks, rankedArtistIds, rankedReleaseIds, rankedTrackIds } from '~/server/utils/searchRank'

const RANKERS = {
  artists: { rank: rankedArtistIds, hydrate: hydrateArtists },
  releases: { rank: rankedReleaseIds, hydrate: hydrateReleases },
  tracks: { rank: rankedTrackIds, hydrate: hydrateTracks },
} as const

type SearchType = keyof typeof RANKERS

export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type') as SearchType
  if (!(type in RANKERS)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown search type' })
  }

  const query = getQuery(event)
  const searchQuery = (typeof query.q === 'string' ? query.q : '').trim()
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 48, maxSize: 100 })

  if (searchQuery.length < SEARCH_MIN_CHARS[type]) {
    return { items: [], total: 0, totalCapped: false, page, hasMore: false }
  }

  const { rank, hydrate } = RANKERS[type]
  const { ids, total, totalCapped } = await rank(searchQuery, skip, pageSize)
  const items = await hydrate(ids)

  return paged(items as unknown[], total, { page, pageSize, skip }, { totalCapped })
})
