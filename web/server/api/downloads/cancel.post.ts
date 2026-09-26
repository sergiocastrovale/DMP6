import { cancelDownloadBySource } from '~/server/utils/downloads'
import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { cancelDownloadBodySchema } from '~/server/schemas/downloads'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')
  const { username, id } = await readBodyOf(event, cancelDownloadBodySchema)

  await cancelDownloadBySource(username, id)
  return { success: true }
})
