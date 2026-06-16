<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Radar, CircleStop, Pause, Play, AlertTriangle } from 'lucide-vue-next'
import type { TabItem } from '~/types/ui'

const store = useDownloadsStore()
const { queueActive, pendingCount, readyCount, paused, pausedReason, freeGb, minFreeGb } = storeToRefs(store)

const actionMsg = ref<string | null>(null)

const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))
const unavailable = computed(() => queueActive.value.filter(i => i.status === 'UNAVAILABLE'))
const downloadProgressItems = computed(() => downloading.value.map(i => ({
  status: i.status, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes,
})))

const monitoredArtists = ref(0)
const totalArtists = ref(0)
const allMonitored = computed(() => totalArtists.value > 0 && monitoredArtists.value >= totalArtists.value)
const fetchMonitorCounts = async () => {
  try {
    const r = await $fetch<{ total: number; monitoredCount: number }>('/api/artists/monitoring', { query: { pageSize: 1 } })
    monitoredArtists.value = r.monitoredCount
    totalArtists.value = r.total
  }
  catch { /* ignore */ }
}

const breadcrumbRoot = { label: 'Downloads', to: '/downloads' }
const breadcrumbLabels: Record<string, string> = {
  monitoring: 'Monitoring',
  pending: 'Pending approval',
  merge: 'Ready to merge',
  downloading: 'Downloading',
  failed: 'Failed',
  unavailable: 'Unavailable',
  history: 'History',
}

const tabs = computed<TabItem[]>(() => [
  { key: 'monitoring', label: 'Monitoring', href: '/downloads/monitoring' },
  { key: 'pending', label: 'Pending approval', href: '/downloads/pending', count: pendingCount.value, countHighlight: true },
  { key: 'merge', label: 'Ready to merge', href: '/downloads/merge', count: readyCount.value, countHighlight: true },
  { key: 'downloading', label: 'Downloading', href: '/downloads/downloading', count: downloading.value.length, countHighlight: true },
  { key: 'failed', label: 'Failed', href: '/downloads/failed', count: failed.value.length, countHighlight: true },
  { key: 'unavailable', label: 'Unavailable', href: '/downloads/unavailable', count: unavailable.value.length, countHighlight: true },
  { key: 'history', label: 'History', href: '/downloads/history' },
])

const monitorBusy = ref(false)
const monitorAll = async (on: boolean) => {
  monitorBusy.value = true
  try {
    const r = await store.monitorAll(on)
    actionMsg.value = `${on ? 'Monitoring' : 'Stopped monitoring'} ${r.count} artists`
    await fetchMonitorCounts()
  }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Monitor-all failed' }
  finally { monitorBusy.value = false }
}

const pauseBusy = ref(false)
const togglePause = async () => {
  pauseBusy.value = true
  actionMsg.value = null
  const err = await store.setPaused(!paused.value)
  if (err) {
    actionMsg.value = err
  }
  pauseBusy.value = false
}

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  store.fetchQueue()
  store.checkStatus()
  fetchMonitorCounts()
  poll = setInterval(() => store.fetchQueue(), 2000)
})
onUnmounted(() => { if (poll) { clearInterval(poll) } })
</script>

<template>
  <TabShell :breadcrumb-root="breadcrumbRoot" :breadcrumb-labels="breadcrumbLabels" :tabs="tabs">
    <template #header>
      <div class="flex flex-col gap-4">
        <PageTitle text="Downloads" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-ink-2">
            Monitoring <span class="font-semibold text-ink">{{ monitoredArtists.toLocaleString() }}</span>/{{ totalArtists.toLocaleString() }} artists
          </span>
          <div class="flex items-center gap-2">
            <UiButton
              size="sm"
              :variant="paused ? 'primary' : 'secondary'"
              :icon="paused ? Play : Pause"
              :loading="pauseBusy"
              @click="togglePause"
            >
              {{ paused ? 'Continue all downloads' : 'Pause all downloads' }}
            </UiButton>
            <UiButton size="sm" :variant="allMonitored ? 'primary' : 'secondary'" :icon="Radar" :loading="monitorBusy" @click="monitorAll(true)">
              Monitor all
            </UiButton>
            <UiButton size="sm" variant="secondary" :icon="CircleStop" :loading="monitorBusy" @click="monitorAll(false)">
              Monitor none
            </UiButton>
          </div>
        </div>

        <div
          v-if="paused"
          class="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"
          :class="pausedReason === 'disk-full' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'"
        >
          <AlertTriangle :size="15" />
          <span v-if="pausedReason === 'disk-full'">
            Downloads auto-paused — disk full ({{ freeGb }} GB free, need {{ minFreeGb }} GB). Free space, then Continue.
          </span>
          <span v-else>All downloads paused. New downloads, catalogue scans and auto-merge are halted until you continue.</span>
        </div>

        <p v-if="actionMsg" class="rounded-lg border border-rule bg-bg-1 px-4 py-2 text-sm text-ink-2">
          {{ actionMsg }}
        </p>

        <DownloadsDownloadProgress v-if="downloading.length" :items="downloadProgressItems" class="rounded-lg border border-rule bg-bg-1 px-4 py-3" />
      </div>
    </template>

    <slot />
  </TabShell>
</template>
