import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/common'
import { requeueRejectedDownloads } from '~/server/utils/promote'

// Bulk "Move all back to queue" for the Rejected tab.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids: bodyIds } = await readBodyOf(event, optionalIdsBodySchema)
  const ids = bodyIds ?? []
  if (!ids.length) {
    return { requeued: 0 }
  }

  return requeueRejectedDownloads(ids)
})
