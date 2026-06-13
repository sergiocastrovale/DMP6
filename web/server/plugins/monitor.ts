import { runMonitorCycle, runGapsCycle, reconcileDownloads } from '~/server/utils/monitorLoop'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'

// Per-artist monitoring (see docs/feature_monitoring.md). One base tick drives everything:
//  - reconcile every tick: finalize/fail in-flight downloads ASAP (progress-driven)
//  - download cycle every monitorIntervalMin: grab missing releases of monitored artists
//  - catalogue gaps every monitorGapsHours: surface newly-released albums as MISSING
// Cadences/caps are read live from settings each tick, so the Settings → Monitoring tab
// applies without a restart. Only the base tick (RECONCILE_SEC) is fixed at boot.
export default defineNitroPlugin(() => {
  const tickSec = Math.max(2, Number(process.env.RECONCILE_SEC) || 5)
  console.log(`[monitor] enabled: base tick ${tickSec}s; cadences/caps from Settings (DB overrides env)`)

  // First periodic cycles run after a full interval; immediate per-artist kicks come from the
  // Monitor toggle (PATCH /api/artists/[slug]). Gaps wait a full gaps-interval.
  let lastDownloadAt = Date.now()
  let lastGapsAt = Date.now()
  let ticking = false

  setInterval(async () => {
    if (ticking) return
    ticking = true
    try {
      await reconcileDownloads()

      const mon = await resolveMonitorSettings()
      if (!mon.monitorEnabled) return

      const now = Date.now()
      if (now - lastDownloadAt >= mon.monitorIntervalMin * 60_000) {
        lastDownloadAt = now
        await runMonitorCycle(mon.monitorCap)
      }
      if (now - lastGapsAt >= mon.monitorGapsHours * 3_600_000) {
        lastGapsAt = now
        await runGapsCycle()
      }
    }
    catch (e: any) {
      console.error(`[monitor] tick error: ${e?.message || e}`)
    }
    finally {
      ticking = false
    }
  }, tickSec * 1000)
})
