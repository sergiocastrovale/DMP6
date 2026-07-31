import { requirePermission } from '~/server/utils/permissions'
import { mergeDownloadedRelease } from '~/server/utils/promote'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  const { localReleaseId, error } = await mergeDownloadedRelease(id)
  if (!localReleaseId && error) throw createError({ statusCode: 422, message: error })
  return { success: true, localReleaseId }
})
