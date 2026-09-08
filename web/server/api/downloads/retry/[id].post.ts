import { requirePermission } from '~/server/utils/permissions'
import { forceRetryDownload } from '~/server/utils/autoDownload'
import { assertCanAcquire } from '~/server/utils/downloadEnvironment'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  await assertCanAcquire()

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, message: 'id required' })}

  await forceRetryDownload(id)
  return { success: true }
})
