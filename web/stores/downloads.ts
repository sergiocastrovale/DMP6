import { defineStore } from 'pinia'
import type { ActiveDownload, DownloadSourceStatus, DownloadedReleaseItem } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

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

  let pollInterval: ReturnType<typeof setInterval> | null = null

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

  const merge = async (id: string) => {
    await $fetch(`/api/downloads/merge/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  // Bulk: sequential (merge/reject are heavy); one failure doesn't abort the rest.
  const rejectAll = async (ids: string[]) => {
    for (const id of ids) {
      await $fetch(`/api/downloads/reject/${id}`, { method: 'POST' }).catch(() => {})
    }
    await fetchQueue()
  }
  const mergeAll = async (ids: string[]) => {
    await $fetch('/api/downloads/merge-all', { method: 'POST', body: { ids } })
    await fetchQueue()
  }

  const monitorAll = async (monitored: boolean) =>
    $fetch<{ monitored: boolean; count: number }>('/api/artists/monitor-all', { method: 'POST', body: { monitored } })

  return {
    slskd,
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
  }
})
