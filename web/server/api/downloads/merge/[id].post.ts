import { requirePermission } from '~/server/utils/permissions'
import { mergeDownloadedRelease } from '~/server/utils/promote'
import { assertCanMerge } from '~/server/utils/downloadEnvironment'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  await assertCanMerge()

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, message: 'id required' })}

  const { localReleaseId, error } = await mergeDownloadedRelease(id)
  if (!localReleaseId && error) {throw createError({ statusCode: 422, message: error })}
  return { success: true, localReleaseId }
})
