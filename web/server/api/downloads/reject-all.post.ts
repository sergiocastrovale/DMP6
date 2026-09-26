import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { optionalIdsBodySchema } from '~/server/schemas/common'
import { forceRejectDownloadedReleases } from '~/server/utils/promote'

// Bulk reject: always terminal (REJECTED), bypassing the attempts cap that the single-row reject
// endpoint uses — see forceRejectDownloadedReleases for why.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids: bodyIds } = await readBodyOf(event, optionalIdsBodySchema)
  const ids = bodyIds ?? []
  if (!ids.length) {
    return { rejected: 0 }
  }

  return forceRejectDownloadedReleases(ids)
})
