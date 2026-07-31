import { cancelDownloadBySource } from '~/server/utils/downloads'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')
  const body = await readBody(event)
  const { username, id } = body as {
    username: string
    id: string
  }

  if (!id) { throw createError({ statusCode: 400, message: 'id is required' }) }

  await cancelDownloadBySource(username || '', id)
  return { success: true }
})
