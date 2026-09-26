import { requirePermission } from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { idsBodySchema } from '~/server/schemas/common'
import { restoreMonitorEvents } from '~/server/utils/monitorEvents'

// Put archived monitor issues back on the flagged list.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids } = await readBodyOf(event, idsBodySchema)

  return { restored: await restoreMonitorEvents(ids) }
})
