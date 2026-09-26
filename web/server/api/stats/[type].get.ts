import { createHash } from 'node:crypto'
import { cachedResponse } from '~/server/utils/cache'
import { parsePagination } from '~/server/utils/pagination'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { runStatQuery, VALID_TYPES } from '~/server/utils/statsQueries'

// Stat pages are pure reads of library aggregates (some over 1.9M tracks) that only change when a scan runs, so
// each distinct (type, filters, page, user) is cached for 5 minutes, library-versioned. `plays` and
// `recent-plays` are per-user, hence the userId in their key; everything else is shared by all users.
const PER_USER_TYPES = new Set(['plays', 'recent-plays'])

export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type')
  if (!type || !VALID_TYPES.has(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid stat type' })
  }

  const query = getQuery(event)
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 200, maxSize: 200 })
  const search = ((query.search as string)?.trim() || '').slice(0, 100)
  const sort = (query.sort as string) || ''
  const order = ((query.order as string) === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc'
  const userId = PER_USER_TYPES.has(type) ? currentUserId(event) : null

  const keyParts = JSON.stringify([type, query.bucket ?? '', query.artist ?? '', query.period ?? '', search, sort, order, page, pageSize, userId])
  const cacheKey = `stats:type:${createHash('sha1').update(keyParts).digest('hex')}`

  return cachedResponse(cacheKey, 300, () => runStatQuery(type, query, { userId, search, skip, pageSize, page, sort, order }), { shared: true })
})

