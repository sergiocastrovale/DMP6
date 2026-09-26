import type { ResolvedMonitorSettings } from '~/types/download'
import { envInt } from '~/helpers/functions'
import { getSettingsRow } from '~/server/utils/settings'

/**
 * Monitoring/downloader knobs, resolved DB → env → default (DB wins; null in DB = use env).
 * Queried per call (like downloadSettings) so UI changes apply live, no restart.
 */
export async function resolveMonitorSettings(): Promise<ResolvedMonitorSettings> {
  const s = await getSettingsRow().catch(() => null)

  const envEnabled = process.env.MONITOR_ENABLED !== 'false'

  return {
    monitorEnabled: s?.monitorEnabled ?? envEnabled,
    retryCooldownDays: s?.retryCooldownDays ?? envInt('RETRY_COOLDOWN_DAYS', 7),
    noProgressSec: s?.noProgressSec ?? envInt('NO_PROGRESS_SEC', 300),
    maxDownloadAttempts: s?.maxDownloadAttempts ?? envInt('MAX_DOWNLOAD_ATTEMPTS', 3),
    maxConcurrentDownloads: s?.maxConcurrentDownloads ?? envInt('MAX_CONCURRENT_DOWNLOADS', 5),
    searchPicksPerInterval: s?.searchPicksPerInterval ?? envInt('SEARCH_PICKS_PER_INTERVAL', 3),
    searchIntervalSec: s?.searchIntervalSec ?? envInt('SEARCH_INTERVAL_SEC', 60),
    gapsPicksPerRun: s?.gapsPicksPerRun ?? envInt('GAPS_PICKS_PER_RUN', 20),
    gapsIntervalMin: s?.gapsIntervalMin ?? envInt('GAPS_INTERVAL_MIN', 5),
    downloadsMinFreeGb: envInt('DOWNLOADS_MIN_FREE_GB', 5),
  }
}
