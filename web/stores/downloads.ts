import { defineStore } from 'pinia'
import type { ActiveDownload, DownloadSourceStatus, DownloadedReleaseItem } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

  // Approval queue (DownloadedRelease rows)
  const queueActive = ref<DownloadedReleaseItem[]>([])
  const queueReady = ref<DownloadedReleaseItem[]>([])
  const queueHistory = ref<DownloadedReleaseItem[]>([])
  const pendingCount = computed(() => queueActive.value.filter(i => i.status === 'PENDING').length)
  const readyCount = computed(() => queueReady.value.length)

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
      const data = await $fetch<{ active: DownloadedReleaseItem[]; ready: DownloadedReleaseItem[]; history: DownloadedReleaseItem[] }>('/api/downloads/queue')
      queueActive.value = data.active
      queueReady.value = data.ready
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

  const retry = async (id: string) => {
    await $fetch(`/api/downloads/retry/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  const merge = async (id: string) => {
    await $fetch(`/api/downloads/merge/${id}`, { method: 'POST' })
    await fetchQueue()
  }

  // Bulk: sequential (merge/reject are heavy); one failure doesn't abort the rest.
  const approveAll = async (ids: string[]) => {
    for (const id of ids) {
      await $fetch(`/api/downloads/approve/${id}`, { method: 'POST' }).catch(() => {})
    }
    await fetchQueue()
  }
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
    pendingCount,
    readyCount,
    fetchQueue,
    approve,
    reject,
    retry,
    merge,
    approveAll,
    rejectAll,
    mergeAll,
    monitorAll,
  }
})
