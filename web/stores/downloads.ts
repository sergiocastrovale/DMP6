import { defineStore } from 'pinia'
import type { ActiveDownload, DownloadSourceStatus, DownloadSourceConfigItem, DownloadedReleaseItem } from '~/types/download'

type MergeStep = 'moving' | 'indexing' | 'syncing'
type MergeProgressMap = Record<string, { step: MergeStep; title: string }>

const MERGE_STEPS: MergeStep[] = ['moving', 'indexing', 'syncing']
const MERGE_STEP_LABELS: Record<MergeStep, (title: string) => string> = {
  moving: title => `Moving "${title}" to library…`,
  indexing: title => `Indexing "${title}"…`,
  syncing: title => `Syncing "${title}"…`,
}

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const prowlarr = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const qbittorrent = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

  // DownloadSources config (the header on/off switches: RuTracker + Soulseek).
  const sources = ref<DownloadSourceConfigItem[]>([])
  // Any source enabled => a manual download can be queued (gates the per-release Download button).
  const sourceEnabled = computed(() => sources.value.some(s => s.enabled))

  // Download queue (DownloadedRelease rows)
  const queueActive = ref<DownloadedReleaseItem[]>([])
  const queueReady = ref<DownloadedReleaseItem[]>([])
  const queueHistory = ref<DownloadedReleaseItem[]>([])
  const readyCount = computed(() => queueReady.value.length)

  // Global pause state (DB-backed; auto-set on disk-full).
  const paused = ref(false)
  const pausedReason = ref<string | null>(null)
  const freeGb = ref<number | null>(null)
  const minFreeGb = ref<number | null>(null)

  // Merge progress (server-driven, so it persists across tab switches + page refresh).
  const mergeProgress = ref<MergeProgressMap>({})
  const mergeInitiated = ref<Set<string>>(new Set()) // optimistic per-row/selected ids (instant spinner, lag-free count)
  const mergeBatchRunning = ref(false) // batched "Merge all" request is in flight (opaque, server-tracked)
  const mergeTotal = ref(0) // batch size for the X-of-Y denominator

  // Per-row merge-button spinner: union of locally-initiated + server-reported ids.
  const mergingIds = computed(() => new Set([...mergeInitiated.value, ...Object.keys(mergeProgress.value)]))
  const mergeActive = computed(() => mergingIds.value.size > 0 || mergeBatchRunning.value)

  // In-flight item count: the per-row/selected path knows it precisely; the batched path relies on the
  // server map, falling back to "nothing done yet" during the poll-lag windows at start/end.
  const mergeInFlightCount = computed(() => {
    if (mergeInitiated.value.size > 0) {
      return mergeInitiated.value.size
    }
    const mapCount = Object.keys(mergeProgress.value).length
    if (mapCount > 0) {
      return mapCount
    }
    return mergeBatchRunning.value ? mergeTotal.value : 0
  })

  const mergeStepIndex = (step: MergeStep) => MERGE_STEPS.indexOf(step)
  const mergeLabel = computed(() => {
    const entries = Object.values(mergeProgress.value)
    if (!entries.length) {
      return null
    }
    const highest = entries.reduce((a, b) => mergeStepIndex(a.step) >= mergeStepIndex(b.step) ? a : b)
    return MERGE_STEP_LABELS[highest.step](highest.title)
  })
  const mergePercent = computed(() => {
    const total = mergeTotal.value * 3
    if (!total) {
      return 0
    }
    const doneItems = mergeTotal.value - mergeInFlightCount.value
    const doneSteps = doneItems * 3
    const inFlightSteps = Object.values(mergeProgress.value).reduce((sum, p) => sum + mergeStepIndex(p.step), 0)
    return Math.round(Math.min(Math.max(doneSteps + inFlightSteps, 0) / total * 100, 99))
  })

  let pollInterval: ReturnType<typeof setInterval> | null = null

  const activeCount = computed(() =>
    activeDownloads.value.filter(d =>
      d.state.includes('InProgress') || d.state === 'Queued' || d.state === 'Initializing',
    ).length,
  )

  const checkStatus = async () => {
    try {
      const data = await $fetch<{ slskd: DownloadSourceStatus; prowlarr: DownloadSourceStatus; qbittorrent: DownloadSourceStatus }>('/api/downloads/status')
      slskd.value = data.slskd
      prowlarr.value = data.prowlarr
      qbittorrent.value = data.qbittorrent
      statusChecked.value = true
    }
    catch {
      statusChecked.value = true
    }
  }

  const fetchSources = async () => {
    try {
      const data = await $fetch<{ sources: DownloadSourceConfigItem[] }>('/api/downloads/sources')
      sources.value = data.sources
    }
    catch { /* ignore */ }
  }

  // Flip a source's on/off switch. RuTracker takes priority; Soulseek is the fallback.
  const toggleSource = async (name: 'RUTRACKER' | 'SLSKD', enabled: boolean) => {
    const data = await $fetch<{ sources: DownloadSourceConfigItem[] }>('/api/downloads/sources', {
      method: 'PUT', body: { name, enabled },
    })
    sources.value = data.sources
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
      const data = await $fetch<{ active: DownloadedReleaseItem[]; ready: DownloadedReleaseItem[]; history: DownloadedReleaseItem[]; paused: boolean; pausedReason: string | null; freeGb: number | null; minFreeGb: number | null }>('/api/downloads/queue')
      queueActive.value = data.active
      queueReady.value = data.ready
      queueHistory.value = data.history
      paused.value = data.paused
      pausedReason.value = data.pausedReason
      freeGb.value = data.freeGb
      minFreeGb.value = data.minFreeGb
    }
    catch { /* ignore */ }
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

  const retry = async (id: string) => {
    await $fetch(`/api/downloads/retry/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const cancel = async (id: string) => {
    await $fetch(`/api/downloads/cancel/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const fetchMergeProgress = async () => {
    try {
      mergeProgress.value = await $fetch<MergeProgressMap>('/api/downloads/merge-progress')
    }
    catch { /* ignore */ }
    // Refresh-recovery: a merge running server-side with no local total -> seed it so the panel renders.
    const active = Object.keys(mergeProgress.value).length
    if (active > 0 && mergeTotal.value === 0) {
      mergeTotal.value = active
    }
    if (active === 0 && mergeInitiated.value.size === 0) {
      mergeTotal.value = 0
    }
  }

  // Concurrent: many merges can be in flight at once, each tracked independently.
  const merge = async (id: string) => {
    mergeInitiated.value = new Set(mergeInitiated.value).add(id)
    try {
      await $fetch(`/api/downloads/merge/${id}`, { method: 'POST' })
    }
    finally {
      const next = new Set(mergeInitiated.value)
      next.delete(id)
      mergeInitiated.value = next
      await fetchQueue()
    }
  }

  const mergeSelected = async (ids: string[]) => {
    if (!ids.length) {
      return
    }
    mergeTotal.value = ids.length
    try {
      await Promise.all(ids.map(id => merge(id)))
    }
    finally {
      mergeTotal.value = 0
    }
  }

  // Bulk: sequential (merge/reject are heavy); one failure doesn't abort the rest.
  const rejectAll = async (ids: string[]) => {
    for (const id of ids) {
      await $fetch(`/api/downloads/reject/${id}`, { method: 'POST' }).catch(() => {})
    }
    await fetchQueue()
  }
  const mergeAll = async (ids: string[]) => {
    mergeTotal.value = ids.length
    mergeBatchRunning.value = true // keep panel visible through the poll-lag windows
    try {
      await $fetch('/api/downloads/merge-all', { method: 'POST', body: { ids } })
    }
    finally {
      mergeBatchRunning.value = false
      mergeTotal.value = 0
      await fetchQueue()
    }
  }

  const monitorAll = async (monitored: boolean) =>
    $fetch<{ monitored: boolean; count: number }>('/api/artists/monitor-all', { method: 'POST', body: { monitored } })

  return {
    slskd,
    prowlarr,
    qbittorrent,
    sources,
    sourceEnabled,
    fetchSources,
    toggleSource,
    activeDownloads,
    statusChecked,
    activeCount,
    checkStatus,
    fetchActive,
    startPolling,
    stopPolling,
    queueActive,
    queueReady,
    queueHistory,
    readyCount,
    paused,
    pausedReason,
    freeGb,
    minFreeGb,
    setPaused,
    fetchQueue,
    reject,
    retry,
    cancel,
    merge,
    rejectAll,
    mergeAll,
    monitorAll,
    mergeProgress,
    mergingIds,
    mergeActive,
    mergeLabel,
    mergePercent,
    mergeSelected,
    fetchMergeProgress,
  }
})
