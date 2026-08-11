import { runGapsCycle, runAutoMergeCycle, reconcileDownloads, reconcileTorrentDownloads } from '~/server/utils/monitorLoop'
import { sweepDanglingDownloads } from '~/server/utils/promote'
import { topUpDownloads } from '~/server/utils/autoDownload'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { ensureDownloadSources, downloadWorkPossible } from '~/server/utils/downloadSources'
import { enforceDiskGuard } from '~/server/utils/pauseState'
import { resolveAutoScanSettings, runAutoScan, shouldRunAutoScan } from '~/server/utils/autoScan'
import { monitorLog } from '~/server/utils/monitorLog'
import { prisma } from '~/server/utils/prisma'

// Keep the MonitorEvent ring small: drop anything older than this on a slow cadence (primary only).
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastPruneAt = 0

// Sweep terminal DownloadedRelease rows whose release is no longer MISSING (audit item 5 — this used
// to run ONLY via the manual /api/downloads/cleanup endpoint, so the bloat it exists to fix
// accumulated silently between manual runs). Pure DB op, safe on any instance — same slow cadence as
// the MonitorEvent prune above. cleanupReadyDownloads is deliberately NOT scheduled here: it throws a
// 409 on any instance without the downloads volume mounted (dev/non-NAS), so auto-running it would
// spam errors everywhere but the NAS — it stays a manual, NAS-only action.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastSweepAt = 0

// Tracks the acquisition idle/active transition so we log it once, not every tick.
let acquisitionIdle = false

// One unattended scan at a time - a full index+sync outlives many ticks.
let autoScanRunning = false

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

  setInterval(() => {
    tick().catch(e => monitorLog('error', `tick crashed (recovered, retrying next tick): ${e?.message || e}`))
  }, tickSec * 1000)

  // Whole tick body wrapped by the setInterval callback's .catch() above - a bare unguarded await
  // rejecting here would otherwise be an unhandled promise rejection, which crashes the Node process
  // (and the monitor loop with it) on a single DB blip. Every step still logs its own error too, so
  // partial failures are visible without needing to unwind the stack trace.
  async function tick() {
    if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) {
      lastPruneAt = Date.now()
      prisma.monitorEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EVENT_RETENTION_MS) } } })
        .catch(() => {})
    }

    if (Date.now() - lastSweepAt > SWEEP_INTERVAL_MS) {
      lastSweepAt = Date.now()
      sweepDanglingDownloads().catch(e => monitorLog('error', `dangling-download sweep error: ${e?.message || e}`))
    }

    // Always reconcile (cheap, bounded, internally guarded). Soulseek + torrent finalizers both run.
    reconcileDownloads().catch(e => monitorLog('error', `reconcile error: ${e?.message || e}`))
    reconcileTorrentDownloads().catch(e => monitorLog('error', `torrent reconcile error: ${e?.message || e}`))

    // Unattended library scan. Deliberately ahead of the monitorEnabled gate below: it is a library
    // concern, not a downloader one, so it still runs with acquisition disabled. Off unless the user
    // turns it on in Settings → Library.
    if (!autoScanRunning) {
      const scan = await resolveAutoScanSettings().catch(() => null)
      if (scan && shouldRunAutoScan(scan, new Date())) {
        autoScanRunning = true
        runAutoScan()
          .catch(e => monitorLog('error', `auto-scan error: ${e?.message || e}`))
          .finally(() => { autoScanRunning = false })
      }
    }

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
  }
})
