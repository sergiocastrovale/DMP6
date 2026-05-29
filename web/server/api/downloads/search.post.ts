import { searchSlskd } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { query, timeout } = body as {
    query: string
    timeout?: number
  }

  if (!query) { throw createError({ statusCode: 400, message: 'query is required' }) }

  const searchId = await searchSlskd(query, timeout)
  return { searchId, source: 'slskd' }
})
