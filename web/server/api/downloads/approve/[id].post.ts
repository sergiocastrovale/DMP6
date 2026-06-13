import { requirePermission } from '~/server/utils/permissions'
import { promoteDownloadedRelease } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  const { localReleaseId } = await promoteDownloadedRelease(id)
  return { success: true, localReleaseId }
})
