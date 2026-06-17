import { runGapsCycle, runAutoMergeCycle, reconcileDownloads, reconcileTorrentDownloads } from '~/server/utils/monitorLoop'
import { topUpDownloads } from '~/server/utils/autoDownload'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { ensureDownloadSources } from '~/server/utils/downloadSources'
import { enforceDiskGuard } from '~/server/utils/pauseState'
import { monitorLog } from '~/server/utils/monitorLog'

// Always-on, headless acquisition (see docs/feature_monitoring.md). One base tick fires three
// INDEPENDENT, self-guarded, self-throttled workers (none awaited together, so a slow Soulseek
// search can never block finalization):
//   - reconcileDownloads: finalize/fail in-flight downloads + auto-approve (every tick)
//   - topUpDownloads:     trickle new MISSING grabs, concurrency-capped (throttled internally)
//   - runGapsCycle:       round-robin catalogue refresh so new releases surface as MISSING
// Each worker has its own running-guard + interval gate, so they self-pace; only the base tick
// (RECONCILE_SEC) is fixed at boot. No web UI needed — runs as long as the container is up.
export default defineNitroPlugin(() => {
  const tickSec = Math.max(2, Number(process.env.RECONCILE_SEC) || 5)
  monitorLog('notice', `enabled: base tick ${tickSec}s; cadences/caps from Settings (DB overrides env)`)

  // Make sure the DownloadSources config rows (RuTracker + Soulseek) exist before any routing runs.
  ensureDownloadSources().catch(e => monitorLog('error', `ensure download sources: ${e?.message || e}`))

  setInterval(async () => {
    // Always reconcile (cheap, bounded, internally guarded). Soulseek + torrent finalizers both run.
    reconcileDownloads().catch(e => monitorLog('error', `reconcile error: ${e?.message || e}`))
    reconcileTorrentDownloads().catch(e => monitorLog('error', `torrent reconcile error: ${e?.message || e}`))

    const mon = await resolveMonitorSettings().catch(() => null)
    if (!mon?.monitorEnabled) return

    // Disk-full → auto-pause. When paused (manual or disk-full), skip all NEW automated work;
    // reconcile above still finalizes in-flight downloads and can free space.
    const { downloadsPath } = await resolveDownloadSettings()
    const paused = await enforceDiskGuard(downloadsPath, mon.downloadsMinFreeGb).catch(() => false)
    if (paused) return

    // Fire-and-forget; each self-throttles + self-guards against overlap.
    topUpDownloads().catch(e => monitorLog('error', `topUp error: ${e?.message || e}`))
    runGapsCycle().catch(e => monitorLog('error', `gaps error: ${e?.message || e}`))
    runAutoMergeCycle().catch(e => monitorLog('error', `auto-merge error: ${e?.message || e}`))
  }, tickSec * 1000)
})
