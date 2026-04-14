import { deleteSlskdSearch } from '~/server/utils/slskd'

export default defineEventHandler(async (event) => {
  const searchId = getRouterParam(event, 'id')
  if (!searchId) throw createError({ statusCode: 400, message: 'search id required' })

  await deleteSlskdSearch(searchId)
  return { success: true }
})
