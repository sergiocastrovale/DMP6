import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { createApiKey } from '~/server/utils/apiKeys'
import { readBodyOf } from '~/server/utils/requestValidation'
import { createApiKeyBodySchema } from '~/server/schemas/apiKeys'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const { name } = await readBodyOf(event, createApiKeyBodySchema)

  const { id, key } = await createApiKey(userId, name)
  // The plaintext key is only ever returned here - only its sha256 hash is persisted, so this
  // response is the caller's one chance to see it.
  return { id, key }
})
