import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/common'
import { forceRetryDownloads } from '~/server/utils/autoDownload'
import { assertCanAcquire } from '~/server/utils/downloadEnvironment'

// Bulk "Retry" for a multi-select in the Queue tab.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  await assertCanAcquire()

  const { ids: bodyIds } = await readBodyOf(event, optionalIdsBodySchema)
  const ids = bodyIds ?? []
  if (!ids.length) {
    return { retried: 0, failed: 0 }
  }

  return forceRetryDownloads(ids)
})
