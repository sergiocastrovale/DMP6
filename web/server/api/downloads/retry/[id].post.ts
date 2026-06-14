import { requirePermission } from '~/server/utils/permissions'
import { forceRetryDownload } from '~/server/utils/autoDownload'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'id required' })

  await forceRetryDownload(id)
  return { success: true }
})
