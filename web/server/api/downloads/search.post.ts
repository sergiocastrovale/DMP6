import type { DownloadSource } from '~/types/download'
import { searchSlskd, searchDeezer, searchHifi } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { query, source, timeout, artist } = body as {
    query: string
    source: DownloadSource
    timeout?: number
    artist?: string
  }

  if (!query) throw createError({ statusCode: 400, message: 'query is required' })
  if (!source) throw createError({ statusCode: 400, message: 'source is required' })

  if (source === 'slskd') {
    const searchId = await searchSlskd(query, timeout)
    return { searchId, source: 'slskd' }
  }

  if (source === 'deezer') {
    const results = await searchDeezer(query)
    return { results, source: 'deezer' }
  }

  if (source === 'hifi') {
    const results = await searchHifi(query, artist)
    return { results, source: 'hifi' }
  }

  throw createError({ statusCode: 400, message: `Unknown source: ${source}` })
})
