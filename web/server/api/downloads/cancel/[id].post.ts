import { requirePermission } from '~/server/utils/permissions'
import { cancelDownloadedRelease } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  await cancelDownloadedRelease(id)
  return { success: true }
})
