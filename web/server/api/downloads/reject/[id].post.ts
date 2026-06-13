import { requirePermission } from '~/server/utils/permissions'
import { rejectDownloadedRelease } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  await rejectDownloadedRelease(id)
  return { success: true }
})
