import { defineStore } from 'pinia'
import { apiErrorMessage } from '~/helpers/apiError'
import { useTerminalStore } from '~/stores/terminal'
import { createPoller } from '~/helpers/poller'
import { QUEUE_POLL_ACTIVE_MS, QUEUE_POLL_IDLE_MS } from '~/helpers/constants'
import type { DownloadSourceStatus, DownloadedReleaseItem, Acquisition, SongkongHealth, DownloadEnvironment, MergeProgressEntry } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const statusChecked = ref(false)

  // Soulseek on/off switch (Settings.downloadsEnabled). Gates the per-release Download button.
  const downloadsEnabled = ref(true)

  // Whether this instance can physically acquire/merge right now (mounted volumes, ffmpeg, slskd
  // reachability — see server/utils/downloadEnvironment.ts). null = not fetched yet ("unknown"),
  // treated as blocked so buttons never flash live before the first check lands.
  const env = ref<DownloadEnvironment | null>(null)
  const capabilitiesChecked = ref(false)
  const canAcquire = computed(() => capabilitiesChecked.value && downloadsEnabled.value && !!env.value?.downloadsPath.ok && !!env.value?.slskd.ok)
  const canMerge = computed(() => capabilitiesChecked.value && !!env.value?.readyPath.ok && !!env.value?.musicDir.ok && (!env.value?.ffmpegRequired || !!env.value?.ffmpeg.ok))
  const acquireBlockReasons = computed(() => {
    if (!capabilitiesChecked.value) {return ['Checking download environment…']}
    if (!downloadsEnabled.value) {return ['Downloads are switched off in Settings → Downloads']}
    const reasons: string[] = []
    if (env.value && !env.value.downloadsPath.ok) {reasons.push(env.value.downloadsPath.detail!)}
    if (env.value && !env.value.slskd.ok) {reasons.push(env.value.slskd.detail!)}
    return reasons
  })
  const mergeBlockReasons = computed(() => {
    if (!capabilitiesChecked.value) {return ['Checking download environment…']}
    const reasons: string[] = []
    if (env.value && !env.value.readyPath.ok) {reasons.push(env.value.readyPath.detail!)}
    if (env.value && !env.value.musicDir.ok) {reasons.push(env.value.musicDir.detail!)}
    if (env.value?.ffmpegRequired && !env.value.ffmpeg.ok) {reasons.push(env.value.ffmpeg.detail!)}
    return reasons
  })

  // Every reason the download flow can't run at all (acquire or merge), independent of the
  // Settings.downloadsEnabled toggle — used to gate pause/continue-all, which is orthogonal to
  // that switch (nothing to pause/resume if the environment itself can't run either way).
  const environmentBlockReasons = computed(() => {
    if (!capabilitiesChecked.value) {return ['Checking download environment…']}
    if (!env.value) {return []}
    const reasons: string[] = []
    if (!env.value.downloadsPath.ok) {reasons.push(env.value.downloadsPath.detail!)}
    if (!env.value.readyPath.ok) {reasons.push(env.value.readyPath.detail!)}
    if (!env.value.musicDir.ok) {reasons.push(env.value.musicDir.detail!)}
    if (env.value.ffmpegRequired && !env.value.ffmpeg.ok) {reasons.push(env.value.ffmpeg.detail!)}
    if (!env.value.slskd.ok) {reasons.push(env.value.slskd.detail!)}
    return reasons
  })

  // Download queue (DownloadedRelease rows)
  const queueActive = ref<DownloadedReleaseItem[]>([])
  const queueReady = ref<DownloadedReleaseItem[]>([])
  const queueRejected = ref<DownloadedReleaseItem[]>([])
  const queueHistory = ref<DownloadedReleaseItem[]>([])
  const readyCount = computed(() => queueReady.value.length)

  // Global pause state (DB-backed; auto-set on disk-full).
  const paused = ref(false)
  const pausedReason = ref<string | null>(null)
  const freeGb = ref<number | null>(null)
  const minFreeGb = ref<number | null>(null)

  // Why background acquisition is/ isn't running (downloads on/off) — for the idle banner.
  const acquisition = ref<Acquisition | null>(null)

  // Host SongKong drainer liveness — explains why rows sit in ENRICHING (see EnrichmentStalledBanner).
  const songkong = ref<SongkongHealth | null>(null)

  // Library-wide monitored-artist counts (unfiltered by search/list toggles) — shared between the
  // /downloads header subtext and the Monitoring tab, so toggling monitoring for one artist there
  // updates the header count too instead of the two staying independently fetched and drifting.
  const monitoredArtists = ref(0)
  const totalArtists = ref(0)
  const fetchMonitorCounts = async () => {
    try {
      const data = await $fetch<{ total: number; monitoredCount: number }>('/api/artists/monitoring', {
        query: { pageSize: 1, showComplete: true },
      })
      monitoredArtists.value = data.monitoredCount
      totalArtists.value = data.total
    }
    catch { /* ignore */ }
  }

  // Optimistic per-row/selected ids, set while a merge (always terminal-routed) is in flight -
  // instant spinner, lag-free count.
  const mergeInitiated = ref<Set<string>>(new Set())

  // Server-truth mirror of the same in-flight batch (server/utils/mergeProgress.ts), polled
  // alongside the queue. mergeInitiated alone drops to empty the moment the merge-stream fetch
  // ends for ANY reason - including the SSE connection getting cut mid-batch (e.g. an idle-timeout
  // on the Cloudflare Tunnel/reverse proxy during a long silent index/sync step) - even though
  // mergeManyDownloadedReleases keeps running server-side regardless of the client. This survives
  // that: every id in the current batch stays in the map until the WHOLE batch finishes, so its
  // key count is a stable "total in this batch" even across a dropped/reconnected page.
  const mergeProgress = ref<Record<string, MergeProgressEntry>>({})
  const fetchMergeProgress = async () => {
    try {
      mergeProgress.value = await $fetch<Record<string, MergeProgressEntry>>('/api/downloads/merge-progress')
    }
    catch { /* ignore */ }
  }

  const mergingIds = computed(() => mergeInitiated.value)
  const mergeBatchIds = computed(() => Object.keys(mergeProgress.value))
  const mergeBatchTotal = computed(() => mergeBatchIds.value.length)
  // A batch id leaves READY the moment its own stampMerged lands (promoted or invalidated), well
  // before the map entry itself is cleared (that happens once, for every id, only when the whole
  // batch ends) - so "no longer READY" is what actually tracks per-item completion mid-batch.
  const mergeBatchCompleted = computed(() => {
    if (!mergeBatchTotal.value) {return 0}
    const readyIds = new Set(queueReady.value.map(i => i.id))
    return mergeBatchIds.value.filter(id => !readyIds.has(id)).length
  })
  const mergePercent = computed(() => mergeBatchTotal.value ? Math.round((mergeBatchCompleted.value / mergeBatchTotal.value) * 100) : 0)
  const mergeActive = computed(() => mergingIds.value.size > 0 || mergeBatchTotal.value > 0)

  // Is there anything live to watch? Downloads finalizing (reconcile runs even while paused), a merge in
  // flight, or acquisition able to spawn new downloads any tick. When NONE of these hold there's nothing
  // to refresh, so the queue poll stops entirely (no point hammering /queue while idle/paused).
  const hasInFlight = computed(() =>
    queueActive.value.some(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING' || i.status === 'SEARCHING'),
  )
  // How long until the next queue read. 2 s while something is actually moving (a transfer, a merge) so
  // progress feels live; 15 s while merely "acquisition could start a download any tick" - the monitor's own
  // cadence is minutes, so faster polling just re-runs a heavy endpoint for nothing. null when there is
  // nothing to watch at all (paused / acquisition off): the loop stops itself.
  const queuePollDelay = (): number | null =>
    hasInFlight.value || mergeActive.value
      ? QUEUE_POLL_ACTIVE_MS
      : (!paused.value && !!acquisition.value?.canAcquire) ? QUEUE_POLL_IDLE_MS : null

  const checkStatus = async () => {
    try {
      const data = await $fetch<{ slskd: DownloadSourceStatus }>('/api/downloads/status')
      slskd.value = data.slskd
      statusChecked.value = true
    }
    catch {
      statusChecked.value = true
    }
  }

  const fetchDownloadCapabilities = async () => {
    try {
      const data = await $fetch<{ enabled: boolean, canAcquire: boolean, canMerge: boolean, environment: DownloadEnvironment }>('/api/downloads/enabled')
      downloadsEnabled.value = data.enabled
      env.value = data.environment
    }
    catch {
      // No permission, or the request itself failed — never leave a VIEWER (or a broken fetch)
      // showing live download buttons. downloadsEnabled defaults true, so it must be explicitly
      // cleared here; env stays null, which the block-reason computeds treat as "unavailable".
      downloadsEnabled.value = false
    }
    finally {
      capabilitiesChecked.value = true
    }
  }

  const fetchQueue = async () => {
    try {
      const data = await $fetch<{ active: DownloadedReleaseItem[]; ready: DownloadedReleaseItem[]; rejected: DownloadedReleaseItem[]; history: DownloadedReleaseItem[]; paused: boolean; pausedReason: string | null; freeGb: number | null; minFreeGb: number | null; acquisition: Acquisition; songkong: SongkongHealth }>('/api/downloads/queue')
      queueActive.value = data.active
      queueReady.value = data.ready
      queueRejected.value = data.rejected
      queueHistory.value = data.history
      paused.value = data.paused
      pausedReason.value = data.pausedReason
      freeGb.value = data.freeGb
      minFreeGb.value = data.minFreeGb
      acquisition.value = data.acquisition
      env.value = data.acquisition.environment
      capabilitiesChecked.value = true
      songkong.value = data.songkong
    }
    catch { /* ignore */ }
    // Polled together so a merge batch's progress is never more stale than the queue counts it's
    // measured against (mergeBatchCompleted diffs mergeProgress ids against queueReady).
    await fetchMergeProgress()
    // Self-manage the live poll: spin it up whenever there's work to watch (a fresh download/merge just
    // appeared, a source got enabled, etc). The loop tick stops itself once nothing is in flight.
    ensureQueuePolling()
  }

  // The first round always waits one active interval - the queue was only just read, and until it has been
  // there is no state to derive a cadence from. After that queuePollDelay() decides, and pauses while the tab
  // is hidden (helpers/poller.ts).
  let firstRound = true
  const queuePoller = createPoller({
    run: fetchQueue,
    delay: () => {
      if (firstRound) {
        firstRound = false
        return QUEUE_POLL_ACTIVE_MS
      }
      return queuePollDelay()
    },
  })

  const stopQueuePolling = () => {
    queuePoller.stop()
    firstRound = true
  }

  const startQueuePolling = () => {
    queuePoller.start()
  }

  // Called after every queue read and every action that changes it: starts the loop if there is now work to
  // watch, and re-evaluates the cadence if it is already running (idle 15 s -> active 2 s the moment a
  // download starts, without waiting out the old wait).
  const ensureQueuePolling = () => {
    if (queuePollDelay() === null) {return}
    if (queuePoller.active) {
      queuePoller.reschedule()
    }
    else {
      startQueuePolling()
    }
  }

  // Returns null on success, or an error message (e.g. disk still full on resume).
  const setPaused = async (next: boolean): Promise<string | null> => {
    try {
      await $fetch('/api/downloads/pause', { method: 'POST', body: { paused: next } })
      await fetchQueue()
      return null
    }
    catch (e) {
      await fetchQueue()
      return apiErrorMessage(e, 'Failed to update pause state')
    }
  }

  const reject = async (id: string) => {
    await $fetch(`/api/downloads/reject/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  // "Move back to queue" (Rejected tab): resets to FAILED, immediately eligible — see
  // requeueRejectedDownload. Does NOT force a search (that's retry()/"Force retry").
  const requeue = async (id: string) => {
    await $fetch(`/api/downloads/requeue/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const requeueAll = async (ids: string[]): Promise<number> => {
    if (!ids.length) {
      return 0
    }
    const { requeued } = await $fetch<{ requeued: number }>('/api/downloads/requeue-all', { method: 'POST', body: { ids } })
    await fetchQueue()
    return requeued
  }

  const retry = async (id: string) => {
    await $fetch(`/api/downloads/retry/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const retryAll = async (ids: string[]): Promise<{ retried: number, failed: number }> => {
    if (!ids.length) {
      return { retried: 0, failed: 0 }
    }
    const result = await $fetch<{ retried: number, failed: number }>('/api/downloads/retry-all', { method: 'POST', body: { ids } })
    await fetchQueue()
    return result
  }

  const cancel = async (id: string) => {
    await $fetch(`/api/downloads/cancel/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  // Every merge streams through the terminal (toast by default, expandable to the sidebar) - one
  // normalized pattern for all terminal-invoking actions. `mergeInitiated` tracks the ids in flight
  // for this call so per-row/selection-bar busy state and mergeActive work the same for a single
  // merge as for a batch.
  const mergeViaTerminal = async (ids: string[]) => {
    if (!ids.length) {
      return
    }
    mergeInitiated.value = new Set([...mergeInitiated.value, ...ids])
    try {
      await useTerminalStore().runStream('/api/downloads/merge-stream', { ids }, 'merge', 'Merging…')
    }
    finally {
      const next = new Set(mergeInitiated.value)
      ids.forEach(id => next.delete(id))
      mergeInitiated.value = next
      await fetchQueue()
    }
  }

  // Concurrent: many merges can be in flight at once, each tracked independently.
  const merge = async (id: string) => mergeViaTerminal([id])

  // Multi-select merge: route through the batched merge-all endpoint (one index pass + one sync per
  // distinct artist) instead of fanning out N individual merge/[id] calls (N index+sync spawns,
  // serialized on the same Rust DB lock — far slower for no benefit).
  const mergeSelected = async (ids: string[]) => {
    if (!ids.length) {
      return
    }
    await mergeAll(ids)
  }

  // Bulk reject: always terminal (REJECTED) via the batch endpoint — see
  // forceRejectDownloadedReleases. The single-row reject() above stays soft/cap-counted.
  const rejectAll = async (ids: string[]): Promise<number> => {
    if (!ids.length) {
      return 0
    }
    const { rejected } = await $fetch<{ rejected: number }>('/api/downloads/reject-all', { method: 'POST', body: { ids } })
    await fetchQueue()
    return rejected
  }
  const mergeAll = async (ids: string[]): Promise<{ merged: number; errors: string[] }> => {
    await mergeViaTerminal(ids)
    return { merged: 0, errors: [] }
  }

  // Sweep ready-to-merge orphans (staged files gone) + dangling/terminal rows whose release is no
  // longer MISSING — deletes those rows server-side.
  const cleanupReady = async () => {
    const r = await $fetch<{ removed: number; checked: number; danglingRemoved: number }>('/api/downloads/cleanup', { method: 'POST' })
    await fetchQueue()
    return r
  }

  return {
    slskd,
    downloadsEnabled,
    fetchDownloadCapabilities,
    env,
    capabilitiesChecked,
    canAcquire,
    canMerge,
    acquireBlockReasons,
    mergeBlockReasons,
    environmentBlockReasons,
    statusChecked,
    checkStatus,
    queueActive,
    queueReady,
    queueRejected,
    queueHistory,
    readyCount,
    paused,
    pausedReason,
    songkong,
    freeGb,
    minFreeGb,
    acquisition,
    monitoredArtists,
    totalArtists,
    fetchMonitorCounts,
    setPaused,
    fetchQueue,
    reject,
    requeue,
    requeueAll,
    retry,
    retryAll,
    cancel,
    merge,
    rejectAll,
    mergeAll,
    cleanupReady,
    mergingIds,
    mergeActive,
    mergeBatchTotal,
    mergeBatchCompleted,
    mergePercent,
    mergeSelected,
    startQueuePolling,
    stopQueuePolling,
  }
})
