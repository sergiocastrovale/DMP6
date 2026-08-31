import { requirePermission } from '~/server/utils/permissions'
import { restoreMonitorEvents } from '~/server/utils/monitorEvents'

// Put archived monitor issues back on the flagged list.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids } = await readBody<{ ids?: string[] }>(event) ?? {}
  if (!Array.isArray(ids) || ids.length === 0) {
    throw createError({ statusCode: 400, message: 'ids required' })
  }

  return { restored: await restoreMonitorEvents(ids) }
})
