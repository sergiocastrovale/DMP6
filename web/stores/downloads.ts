import { defineStore } from 'pinia'
import type { ActiveDownload, DownloadSourceStatus } from '~/types/download'

export const useDownloadsStore = defineStore('downloads', () => {
  const slskd = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const deezer = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const hifi = ref<DownloadSourceStatus>({ configured: false, connected: false })
  const activeDownloads = ref<ActiveDownload[]>([])
  const statusChecked = ref(false)

  let pollInterval: ReturnType<typeof setInterval> | null = null

  const anyConfigured = computed(() => slskd.value.configured || deezer.value.configured || hifi.value.configured)
  const anyConnected = computed(() => slskd.value.connected || deezer.value.connected || hifi.value.connected)

  const activeCount = computed(() =>
    activeDownloads.value.filter(d =>
      d.state.includes('InProgress') || d.state === 'Queued' || d.state === 'Initializing',
    ).length,
  )

  async function checkStatus() {
    try {
      const data = await $fetch<{
        slskd: DownloadSourceStatus
        deezer: DownloadSourceStatus
        hifi: DownloadSourceStatus
      }>('/api/downloads/status')
      slskd.value = data.slskd
      deezer.value = data.deezer
      hifi.value = data.hifi
      statusChecked.value = true
    }
    catch {
      statusChecked.value = true
    }
  }

  async function fetchActive() {
    try {
      const data = await $fetch<{ downloads: ActiveDownload[] }>('/api/downloads/active')
      activeDownloads.value = data.downloads
    }
    catch { /* ignore */ }
  }

  function startPolling() {
    if (pollInterval) return
    fetchActive()
    pollInterval = setInterval(fetchActive, 3000)
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  return {
    slskd,
    deezer,
    hifi,
    activeDownloads,
    statusChecked,
    anyConfigured,
    anyConnected,
    activeCount,
    checkStatus,
    fetchActive,
    startPolling,
    stopPolling,
  }
})
