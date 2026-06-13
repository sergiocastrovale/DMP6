import { prisma } from '~/server/utils/prisma'

/**
 * Monitoring/downloader knobs, resolved DB → env → default (DB wins; null in DB = use env).
 * Queried per call (like downloadSettings) so UI changes apply live, no restart.
 */
export interface ResolvedMonitorSettings {
  monitorEnabled: boolean
  monitorIntervalMin: number
  monitorCap: number
  monitorGapsHours: number
  monitorRetryHours: number
  noProgressSec: number
  maxDownloadAttempts: number
}

function envInt(name: string, def: number): number {
  const v = process.env[name]
  const n = v != null ? parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : def
}

export async function resolveMonitorSettings(): Promise<ResolvedMonitorSettings> {
  const s = await prisma.settings.findUnique({ where: { id: 'main' } }).catch(() => null)

  const envEnabled = process.env.MONITOR_ENABLED !== 'false'

  return {
    monitorEnabled: s?.monitorEnabled ?? envEnabled,
    monitorIntervalMin: s?.monitorIntervalMin ?? envInt('MONITOR_INTERVAL_MIN', 15),
    monitorCap: s?.monitorCap ?? envInt('MONITOR_CAP', 10),
    monitorGapsHours: s?.monitorGapsHours ?? envInt('MONITOR_GAPS_HOURS', 24),
    monitorRetryHours: s?.monitorRetryHours ?? envInt('MONITOR_RETRY_HOURS', 12),
    noProgressSec: s?.noProgressSec ?? envInt('NO_PROGRESS_SEC', 60),
    maxDownloadAttempts: s?.maxDownloadAttempts ?? envInt('MAX_DOWNLOAD_ATTEMPTS', 3),
  }
}
