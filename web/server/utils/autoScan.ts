import type { AutoScanSettings } from '~/types/scan'
import { prisma } from '~/server/utils/prisma'
import { envInt } from '~/helpers/functions'
import { getSettingsRow, invalidateSettings } from '~/server/utils/settings'
import { runExclusive } from '~/server/utils/scriptLock'
import { runScript } from '~/server/utils/runScript'
import { monitorLog } from '~/server/utils/monitorLog'

// Floor on the configurable interval. An unattended index+sync over a full library is expensive; a
// misconfigured "every 0 hours" would keep the Rust binaries' exclusive DB lock permanently held and
// starve manual runs and the downloader's own index passes.
export const MIN_AUTO_SCAN_INTERVAL_HOURS = 1

/** DB → env → default, same precedence as resolveMonitorSettings. */
export const resolveAutoScanSettings = async (): Promise<AutoScanSettings> => {
  const s = await getSettingsRow().catch(() => null)

  return {
    enabled: s?.autoScanEnabled ?? process.env.AUTO_SCAN_ENABLED === 'true',
    intervalHours: Math.max(
      MIN_AUTO_SCAN_INTERVAL_HOURS,
      s?.autoScanIntervalHours ?? envInt('AUTO_SCAN_INTERVAL_HOURS', 12),
    ),
    lastRunAt: s?.autoScanLastRunAt ?? null,
  }
}

/**
 * Pure due-check, so the schedule is testable without a DB or a clock. A never-run scan is due
 * immediately; a clock that jumped backwards (lastRunAt in the future) is not treated as due, which
 * keeps a bad timestamp from triggering a scan on every tick.
 */
export const shouldRunAutoScan = (
  settings: Pick<AutoScanSettings, 'enabled' | 'intervalHours' | 'lastRunAt'>,
  now: Date,
): boolean => {
  if (!settings.enabled) {
    return false
  }
  if (!settings.lastRunAt) {
    return true
  }
  const elapsedMs = now.getTime() - settings.lastRunAt.getTime()
  return elapsedMs >= Math.max(MIN_AUTO_SCAN_INTERVAL_HOURS, settings.intervalHours) * 60 * 60 * 1000
}

const runStep = async (name: 'index' | 'sync' | 'tidy'): Promise<void> => {
  // Already inside runAutoScan's runExclusive, hence no `exclusive`. Streamed: a full index+sync over 2M files
  // prints far more than execFile's old 64 MB maxBuffer, which killed the scan mid-run.
  const { tail } = await runScript(name)
  monitorLog('notice', `auto-scan: ${name} finished — ${tail[tail.length - 1]?.trim() ?? ''}`)
}

/**
 * One unattended `./index` + `./sync` + `./tidy` pass. Serialized against every other in-process
 * script run (merges, gaps cycles) through runExclusive, because they all share the binaries'
 * exclusive DB lock. The timestamp is stamped even on failure: a broken scan must not retry on every
 * tick.
 */
export const runAutoScan = async (): Promise<void> => {
  await runExclusive(async () => {
    monitorLog('notice', 'auto-scan: starting index + sync + tidy')
    try {
      await runStep('index')
      await runStep('sync')
      await runStep('tidy')
    }
    catch (e: any) {
      monitorLog('error', `auto-scan failed: ${e?.message ?? e}`)
    }
    finally {
      await prisma.settings.update({
        where: { id: 'main' },
        data: { autoScanLastRunAt: new Date() },
      }).catch(() => null)
      invalidateSettings()
    }
  })
}
