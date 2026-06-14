import { runGapsCycle, runAutoMergeCycle, reconcileDownloads } from '~/server/utils/monitorLoop'
import { topUpDownloads } from '~/server/utils/autoDownload'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'

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
  console.log(`[monitor] enabled: base tick ${tickSec}s; cadences/caps from Settings (DB overrides env)`)

  setInterval(async () => {
    // Always reconcile (cheap, bounded, internally guarded).
    reconcileDownloads().catch(e => console.error(`[monitor] reconcile error: ${e?.message || e}`))

    const mon = await resolveMonitorSettings().catch(() => null)
    if (!mon?.monitorEnabled) return

    // Fire-and-forget; each self-throttles + self-guards against overlap.
    topUpDownloads().catch(e => console.error(`[monitor] topUp error: ${e?.message || e}`))
    runGapsCycle().catch(e => console.error(`[monitor] gaps error: ${e?.message || e}`))
    runAutoMergeCycle().catch(e => console.error(`[monitor] auto-merge error: ${e?.message || e}`))
  }, tickSec * 1000)
})
