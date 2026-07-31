import { runGapsCycle, runAutoMergeCycle, reconcileDownloads, reconcileTorrentDownloads } from '~/server/utils/monitorLoop'
import { topUpDownloads } from '~/server/utils/autoDownload'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { ensureDownloadSources, downloadWorkPossible } from '~/server/utils/downloadSources'
import { enforceDiskGuard } from '~/server/utils/pauseState'
import { monitorLog } from '~/server/utils/monitorLog'
import { prisma } from '~/server/utils/prisma'

// Keep the MonitorEvent ring small: drop anything older than this on a slow cadence (primary only).
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastPruneAt = 0

// Tracks the acquisition idle/active transition so we log it once, not every tick.
let acquisitionIdle = false

// Always-on, headless acquisition (see docs/feature_monitoring.md). One base tick fires three
// INDEPENDENT, self-guarded, self-throttled workers (none awaited together, so a slow Soulseek
// search can never block finalization):
//   - reconcileDownloads: finalize/fail in-flight downloads + auto-approve (every tick)
//   - topUpDownloads:     trickle new MISSING grabs, concurrency-capped (throttled internally)
//   - runGapsCycle:       round-robin catalogue refresh so new releases surface as MISSING
// Each worker has its own running-guard + interval gate, so they self-pace; only the base tick
// (RECONCILE_SEC) is fixed at boot. No web UI needed — runs as long as the container is up.
export default defineNitroPlugin(() => {
  // Per-instance, env-ONLY gate (the DB `monitorEnabled` is shared across instances, so it can't pick
  // a primary). Only the instance with MONITOR_PRIMARY=true runs background acquisition; every other
  // instance (e.g. a dev server pointed at the same DB) is UI-only. Without this, two instances both
  // spawn index/sync and collide on the Rust binaries' exclusive DB lock — runExclusive only serializes
  // within one process.
  if (process.env.MONITOR_PRIMARY !== 'true') {
    monitorLog('notice', 'monitor loop disabled (MONITOR_PRIMARY not set) — UI-only instance')
    return
  }

  const tickSec = Math.max(2, Number(process.env.RECONCILE_SEC) || 5)
  monitorLog('notice', `enabled: base tick ${tickSec}s; cadences/caps from Settings (DB overrides env)`)

  // Make sure the DownloadSources config rows (RuTracker + Soulseek) exist before any routing runs.
  ensureDownloadSources().catch(e => monitorLog('error', `ensure download sources: ${e?.message || e}`))

  setInterval(async () => {
    if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) {
      lastPruneAt = Date.now()
      prisma.monitorEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EVENT_RETENTION_MS) } } })
        .catch(() => {})
    }

    // Always reconcile (cheap, bounded, internally guarded). Soulseek + torrent finalizers both run.
    reconcileDownloads().catch(e => monitorLog('error', `reconcile error: ${e?.message || e}`))
    reconcileTorrentDownloads().catch(e => monitorLog('error', `torrent reconcile error: ${e?.message || e}`))

    const mon = await resolveMonitorSettings().catch(() => null)
    if (!mon?.monitorEnabled) {return}

    // Disk-full → auto-pause. When paused (manual or disk-full), skip all NEW automated work;
    // reconcile above still finalizes in-flight downloads and can free space.
    const { downloadsPath } = await resolveDownloadSettings()
    const paused = await enforceDiskGuard(downloadsPath, mon.downloadsMinFreeGb).catch(() => false)
    if (paused) {return}

    // Auto-merge finalizes already-downloaded READY releases into the library — source-independent, so
    // it runs regardless of acquisition state (no-op + off by default anyway).
    runAutoMergeCycle().catch(e => monitorLog('error', `auto-merge error: ${e?.message || e}`))

    // Poll gate: only run the acquisition workers (trickle + catalogue-gap refresh) when some source
    // could actually produce a download. With no source enabled, or RuTracker-only with its daily cap
    // spent, there's nothing to gain from searching/refreshing on a fixed interval — so we stop until a
    // source switch is flipped on or the RT window rolls. Logged once on each transition.
    const canAcquire = await downloadWorkPossible()
    if (!canAcquire) {
      if (!acquisitionIdle) {
        acquisitionIdle = true
        monitorLog('notice', 'acquisition idle: no enabled source with budget — pausing trickle + gaps')
      }
      return
    }
    if (acquisitionIdle) {
      acquisitionIdle = false
      monitorLog('notice', 'acquisition resumed: a source is available again')
    }

    // Fire-and-forget; each self-throttles + self-guards against overlap.
    topUpDownloads().catch(e => monitorLog('error', `topUp error: ${e?.message || e}`))
    runGapsCycle().catch(e => monitorLog('error', `gaps error: ${e?.message || e}`))
  }, tickSec * 1000)
})
