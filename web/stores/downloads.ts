import { defineStore } from 'pinia'
import { useTerminalStore } from '~/stores/terminal'
import type { ActiveDownload, DownloadSourceStatus, DownloadedReleaseItem, Acquisition, SongkongHealth } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

  // Soulseek on/off switch (Settings.downloadsEnabled). Gates the per-release Download button.
  const downloadsEnabled = ref(true)

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

  // Optimistic per-row/selected ids, set while a merge (always terminal-routed) is in flight -
  // instant spinner, lag-free count.
  const mergeInitiated = ref<Set<string>>(new Set())

  const mergingIds = computed(() => mergeInitiated.value)
  const mergeActive = computed(() => mergingIds.value.size > 0)

  // Is there anything live to watch? Downloads finalizing (reconcile runs even while paused), a merge in
  // flight, or acquisition able to spawn new downloads any tick. When NONE of these hold there's nothing
  // to refresh, so the queue poll stops entirely (no point hammering /queue while idle/paused).
  const hasInFlight = computed(() =>
    queueActive.value.some(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING' || i.status === 'SEARCHING'),
  )
  const queuePollNeeded = computed(() =>
    hasInFlight.value || mergeActive.value || (!paused.value && !!acquisition.value?.canAcquire),
  )

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let queuePollTimer: ReturnType<typeof setInterval> | null = null

  const activeCount = computed(() =>
    activeDownloads.value.filter(d =>
      d.state.includes('InProgress') || d.state === 'Queued' || d.state === 'Initializing',
    ).length,
  )

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

  const fetchDownloadsEnabled = async () => {
    try {
      const data = await $fetch<{ enabled: boolean }>('/api/downloads/enabled')
      downloadsEnabled.value = data.enabled
    }
    catch { /* ignore */ }
  }

  const fetchActive = async () => {
    try {
      const data = await $fetch<{ downloads: ActiveDownload[] }>('/api/downloads/active')
      activeDownloads.value = data.downloads
    }
    catch { /* ignore */ }
  }

  const startPolling = () => {
    if (pollInterval) { return }
    fetchActive()
    pollInterval = setInterval(fetchActive, 3000)
  }

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
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
      songkong.value = data.songkong
    }
    catch { /* ignore */ }
    // Self-manage the live poll: spin it up whenever there's work to watch (a fresh download/merge just
    // appeared, a source got enabled, etc). The loop tick stops itself once nothing is in flight.
    ensureQueuePolling()
  }

  const stopQueuePolling = () => {
    if (queuePollTimer) {
      clearTimeout(queuePollTimer)
      queuePollTimer = null
    }
  }

  const startQueuePolling = () => {
    if (queuePollTimer) {
      return
    }
    const tick = async () => {
      await fetchQueue()
      if (queuePollNeeded.value) {
        queuePollTimer = setTimeout(tick, 2000)
      }
      else {
        queuePollTimer = null
      }
    }
    queuePollTimer = setTimeout(tick, 2000)
  }

  const ensureQueuePolling = () => {
    if (queuePollNeeded.value) {
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
    catch (e: any) {
      await fetchQueue()
      return e?.data?.message || e?.message || 'Failed to update pause state'
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
    fetchDownloadsEnabled,
    activeDownloads,
    statusChecked,
    activeCount,
    checkStatus,
    fetchActive,
    startPolling,
    stopPolling,
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
    mergeSelected,
    startQueuePolling,
    stopQueuePolling,
  }
})
