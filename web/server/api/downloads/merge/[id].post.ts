import { requirePermission } from '~/server/utils/permissions'
import { mergeDownloadedRelease } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  const { localReleaseId } = await mergeDownloadedRelease(id)
  return { success: true, localReleaseId }
})
