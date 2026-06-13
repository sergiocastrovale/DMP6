import { defineStore } from 'pinia'
import type { ActiveDownload, DownloadSourceStatus, DownloadedReleaseItem } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

  // Approval queue (DownloadedRelease rows)
  const queueActive = ref<DownloadedReleaseItem[]>([])
  const queueHistory = ref<DownloadedReleaseItem[]>([])
  const pendingCount = computed(() => queueActive.value.filter(i => i.status === 'PENDING').length)

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
      const data = await $fetch<{ active: DownloadedReleaseItem[]; history: DownloadedReleaseItem[] }>('/api/downloads/queue')
      queueActive.value = data.active
      queueHistory.value = data.history
    }
    catch { /* ignore */ }
  }

  const approve = async (id: string) => {
    await $fetch(`/api/downloads/approve/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const reject = async (id: string) => {
    await $fetch(`/api/downloads/reject/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const scanMissing = async (limit = 10, artistId?: string) => {
    const res = await $fetch<{ scanned: number; queued: number; skipped: number; noResult: number; queuedTitles: string[] }>(
      '/api/downloads/scan-missing',
      { method: 'POST', body: { limit, artistId } },
    )
    await fetchQueue()
    return res
  }

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
    queueHistory,
    pendingCount,
    fetchQueue,
    approve,
    reject,
    scanMissing,
  }
})
