import type { MonitorEventCounts } from '~/types/download'
import { prisma } from '~/server/utils/prisma'

// Queries behind the monitor-event endpoints. Extracted from the route handlers so the rules that
// actually matter - archive is idempotent, "delete all archived" can never reach a flagged row - are
// testable against a real database without standing up an HTTP layer.

const EVENT_FIELDS = { id: true, level: true, message: true, createdAt: true, archivedAt: true } as const

// 500 rather than 100 because the Events tab's "Clear shown" archives the ids it has loaded - a lower
// cap would silently leave rows behind. The age-based prune keeps the real ceiling far below this.
export const MAX_EVENT_LIMIT = 500

export const clampEventLimit = (raw: unknown): number =>
  Math.min(MAX_EVENT_LIMIT, Math.max(1, Number(raw) || 50))

export const listMonitorEvents = (options: { archived: boolean, limit: number }) =>
  prisma.monitorEvent.findMany({
    where: { archivedAt: options.archived ? { not: null } : null },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    select: EVENT_FIELDS,
  })

export const monitorEventCounts = async (): Promise<MonitorEventCounts> => {
  const [flagged, archived] = await Promise.all([
    prisma.monitorEvent.count({ where: { archivedAt: null } }),
    prisma.monitorEvent.count({ where: { archivedAt: { not: null } } }),
  ])
  return { flagged, archived }
}

// `archivedAt: null` in the filter keeps this idempotent: re-archiving an already-archived row would
// otherwise move its timestamp and misreport how many rows the click actually changed.
export const archiveMonitorEvents = async (ids: string[]): Promise<number> => {
  const { count } = await prisma.monitorEvent.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { archivedAt: new Date() },
  })
  return count
}

export const restoreMonitorEvents = async (ids: string[]): Promise<number> => {
  const { count } = await prisma.monitorEvent.updateMany({
    where: { id: { in: ids }, archivedAt: { not: null } },
    data: { archivedAt: null },
  })
  return count
}

// Permanent, unlike archiving. `allArchived` deliberately never matches a flagged row: emptying the
// Archived list must not discard issues the user has not dismissed yet.
export const deleteMonitorEvents = async (target: { ids?: string[], allArchived?: boolean }): Promise<number> => {
  const hasIds = Array.isArray(target.ids) && target.ids.length > 0
  if (!hasIds && target.allArchived !== true) {
    throw new Error('ids or allArchived required')
  }
  const { count } = await prisma.monitorEvent.deleteMany({
    where: hasIds ? { id: { in: target.ids! } } : { archivedAt: { not: null } },
  })
  return count
}
