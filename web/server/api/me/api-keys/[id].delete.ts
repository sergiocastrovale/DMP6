import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { revokeApiKey } from '~/server/utils/apiKeys'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

  await revokeApiKey(userId, id)
  return { success: true }
})
