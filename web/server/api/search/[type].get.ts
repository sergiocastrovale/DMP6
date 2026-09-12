import { parsePagination } from '~/server/utils/pagination'
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
  const searchQuery = (query.q as string) || ''
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 48, maxSize: 100 })

  if (searchQuery.length < 2) {
    return { items: [], total: 0, page, hasMore: false }
  }

  const { rank, hydrate } = RANKERS[type]
  const { ids, total } = await rank(searchQuery, skip, pageSize)
  const items = await hydrate(ids)

  return {
    items,
    total,
    page,
    hasMore: skip + items.length < total,
  }
})
