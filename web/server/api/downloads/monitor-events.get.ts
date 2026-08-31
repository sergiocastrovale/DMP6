import { requirePermission } from '~/server/utils/permissions'
import { clampEventLimit, listMonitorEvents, monitorEventCounts } from '~/server/utils/monitorEvents'

// Background monitor-loop issues (warn/error), newest first. Notices are never persisted, so this is
// issues-only by construction. Serves both the "Recent issues" panel (flagged, small limit) and the
// Downloads → Events tab (either list, larger limit).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const query = getQuery(event)
  const [items, counts] = await Promise.all([
    listMonitorEvents({ archived: query.archived === 'true', limit: clampEventLimit(query.limit) }),
    // Additive: the tab badge and the subtab counts need totals rather than the capped page, and the
    // panel keeps reading `items` exactly as before.
    monitorEventCounts(),
  ])

  return { items, counts }
})
