import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prisma } from '~/server/utils/prisma'
import { runExclusive } from '~/server/utils/scriptLock'
import { monitorLog } from '~/server/utils/monitorLog'

const execFileAsync = promisify(execFile)

// Floor on the configurable interval. An unattended index+sync over a full library is expensive; a
// misconfigured "every 0 hours" would keep the Rust binaries' exclusive DB lock permanently held and
// starve manual runs and the downloader's own index passes.
export const MIN_AUTO_SCAN_INTERVAL_HOURS = 1

export interface AutoScanSettings {
  enabled: boolean
  intervalHours: number
  lastRunAt: Date | null
}

const envInt = (name: string, def: number): number => {
  const raw = process.env[name]
  const n = raw != null ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n : def
}

/** DB → env → default, same precedence as resolveMonitorSettings. */
export const resolveAutoScanSettings = async (): Promise<AutoScanSettings> => {
  const s = await prisma.settings.findUnique({ where: { id: 'main' } }).catch(() => null)

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

const runScript = async (name: 'index' | 'sync'): Promise<void> => {
  const scriptsDir = process.env.SCRIPTS_DIR || process.env.PROJECT_ROOT || '.'
  const { stdout, stderr } = await execFileAsync(`${scriptsDir}/${name}`, [], {
    cwd: process.env.PROJECT_ROOT || scriptsDir,
    maxBuffer: 64 * 1024 * 1024,
  })
  const tail = (stdout || stderr || '').trim().split('\n').slice(-1)[0] ?? ''
  monitorLog('notice', `auto-scan: ${name} finished — ${tail}`)
}

/**
 * One unattended `./index` + `./sync` pass. Serialized against every other in-process script run
 * (merges, gaps cycles) through runExclusive, because they all share the binaries' exclusive DB lock.
 * The timestamp is stamped even on failure: a broken scan must not retry on every tick.
 */
export const runAutoScan = async (): Promise<void> => {
  await runExclusive(async () => {
    monitorLog('notice', 'auto-scan: starting index + sync')
    try {
      await runScript('index')
      await runScript('sync')
    }
    catch (e: any) {
      monitorLog('error', `auto-scan failed: ${e?.message ?? e}`)
    }
    finally {
      await prisma.settings.update({
        where: { id: 'main' },
        data: { autoScanLastRunAt: new Date() },
      }).catch(() => null)
    }
  })
}
