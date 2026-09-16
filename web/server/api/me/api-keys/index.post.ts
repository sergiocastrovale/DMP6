import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { createApiKey } from '~/server/utils/apiKeys'

const MAX_NAME_LEN = 100

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const body = (await readBody(event)) ?? {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_NAME_LEN) {
    throw createError({ statusCode: 400, statusMessage: 'Name must be 1-100 characters' })
  }

  const { id, key } = await createApiKey(userId, name)
  // The plaintext key is only ever returned here - only its sha256 hash is persisted, so this
  // response is the caller's one chance to see it.
  return { id, key }
})
