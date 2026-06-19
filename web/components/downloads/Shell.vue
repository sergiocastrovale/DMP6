<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Brush, Pause, Play, AlertTriangle, PauseCircle } from 'lucide-vue-next'
import type { TabItem } from '~/types/ui'

const store = useDownloadsStore()
const toast = useToastStore()
const { queueActive, readyCount, paused, pausedReason, freeGb, minFreeGb, mergeActive, mergeLabel, mergePercent, mergingIds, acquisition } = storeToRefs(store)

const actionMsg = ref<string | null>(null)

const hoursUntil = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) {
    return 'soon'
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Idle when no source can produce a download (and not already covered by the pause banner).
const acquisitionIdle = computed(() => !!acquisition.value && !acquisition.value.canAcquire)
const idleMessage = computed(() => {
  const a = acquisition.value
  if (!a) {
    return ''
  }
  const parts: string[] = []
  if (!a.rt.enabled && !a.slsk.enabled) {
    return 'No download source enabled — turn on RuTracker or Soulseek to resume acquisition.'
  }
  if (a.rt.enabled && a.rt.remaining <= 0) {
    const resets = a.rt.resetsAt ? `, resets in ${hoursUntil(a.rt.resetsAt)}` : ''
    parts.push(`RuTracker daily search limit reached (${a.rt.used}/${a.rt.limit})${resets}`)
  }
  else if (!a.rt.enabled) {
    parts.push('RuTracker disabled')
  }
  parts.push(a.slsk.enabled ? 'Soulseek enabled' : 'Soulseek disabled')
  return `Acquisition idle — ${parts.join('; ')}.`
})
const rtBudgetLabel = computed(() => {
  const a = acquisition.value
  return a?.rt.enabled ? `RuTracker ${a.rt.used}/${a.rt.limit} searches today` : null
})

const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))
const unavailable = computed(() => queueActive.value.filter(i => i.status === 'UNAVAILABLE'))
const downloadProgressItems = computed(() => downloading.value.map(i => ({
  status: i.status, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes,
})))

const monitoredArtists = ref(0)
const totalArtists = ref(0)
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
  merge: 'Ready to merge',
  downloading: 'Downloading',
  failed: 'Failed',
  unavailable: 'Unavailable',
  history: 'History',
}

const tabs = computed<TabItem[]>(() => [
  { key: 'monitoring', label: 'Monitoring', href: '/downloads/monitoring' },
  { key: 'merge', label: 'Ready to merge', href: '/downloads/merge', count: readyCount.value, countHighlight: true },
  { key: 'downloading', label: 'Downloading', href: '/downloads/downloading', count: downloading.value.length, countHighlight: true },
  { key: 'failed', label: 'Failed', href: '/downloads/failed', count: failed.value.length, countHighlight: true },
  { key: 'unavailable', label: 'Unavailable', href: '/downloads/unavailable', count: unavailable.value.length, countHighlight: true },
  { key: 'history', label: 'History', href: '/downloads/history' },
])

const cleanupBusy = ref(false)
const cleanup = async () => {
  cleanupBusy.value = true
  try {
    const r = await store.cleanupReady()
    toast.success(r.removed
      ? `Removed ${r.removed} orphaned release${r.removed === 1 ? '' : 's'} (checked ${r.checked})`
      : `No orphans — all ${r.checked} ready release${r.checked === 1 ? '' : 's'} have their files`)
  }
  catch (e: any) { toast.error(e?.data?.message || e?.message || 'Cleanup failed') }
  finally { cleanupBusy.value = false }
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
onMounted(async () => {
  store.fetchQueue()
  store.checkStatus()
  fetchMonitorCounts()
  // One-shot merge-progress read: only start the merge poll loop if a merge is already running
  // server-side (e.g. after a refresh mid-merge). Otherwise nothing polls merge-progress until the
  // user starts a merge.
  await store.fetchMergeProgress()
  if (store.mergeActive) {
    store.startMergePolling()
  }
  // Queue keeps polling for live download/idle state; merge-progress is demand-driven in the store.
  poll = setInterval(() => store.fetchQueue(), 2000)
})
onUnmounted(() => {
  if (poll) { clearInterval(poll) }
  store.stopMergePolling()
})
</script>

<template>
  <TabShell :breadcrumb-root="breadcrumbRoot" :breadcrumb-labels="breadcrumbLabels" :tabs="tabs">
    <template #header>
      <div class="flex flex-col gap-4">
        <PageTitle text="Downloads" />

        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span class="text-sm text-ink-2">
              Monitoring <span class="font-semibold text-ink">{{ monitoredArtists.toLocaleString() }}</span>/{{ totalArtists.toLocaleString() }} artists
            </span>
            <span v-if="rtBudgetLabel" class="text-xs text-ink-3">· {{ rtBudgetLabel }}</span>
          </div>
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
            <UiButton size="sm" variant="secondary" :icon="Brush" :loading="cleanupBusy" @click="cleanup">
              Cleanup
            </UiButton>
          </div>
        </div>

        <DownloadsDownloadSources />

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

        <div
          v-if="acquisitionIdle && !paused"
          class="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"
        >
          <PauseCircle :size="15" />
          <span>{{ idleMessage }} Background searching is paused until a source is available.</span>
        </div>

        <p v-if="actionMsg" class="rounded-lg border border-rule bg-bg-1 px-4 py-2 text-sm text-ink-2">
          {{ actionMsg }}
        </p>

        <DownloadsDownloadProgress v-if="downloading.length" :items="downloadProgressItems" class="rounded-lg border border-rule bg-bg-1 px-4 py-3" />

        <UiLoadingPanel
          v-if="mergeActive"
          :label="mergeLabel ?? `Merging ${mergingIds.size} release${mergingIds.size !== 1 ? 's' : ''}…`"
          :percent="mergePercent"
          variant="success"
          class="rounded-lg border border-rule bg-bg-1 px-4 py-3"
        />
      </div>
    </template>

    <slot />
  </TabShell>
</template>
