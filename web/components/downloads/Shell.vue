<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Brush, Pause, Play, AlertTriangle } from 'lucide-vue-next'
import type { TabItem } from '~/types/ui'
import { cx, layout } from '~/helpers/ui'

const store = useDownloadsStore()
const settings = useSettingsStore()
const toast = useToastStore()
const { queueActive, readyCount, paused, pausedReason, freeGb, minFreeGb, mergeActive, mergeLabel, mergePercent, mergingIds } = storeToRefs(store)

const actionMsg = ref<string | null>(null)
const issuesPanel = ref<{ fetchEvents: () => Promise<void> } | null>(null)

// Shared with the panel below and the Events tab, so the tab badge drops the moment either archives
// something rather than waiting for a reload.
const { counts: monitorCounts, refreshCounts } = useMonitorEvents()
onMounted(refreshCounts)

watch(mergeActive, (active, was) => {
  if (was && !active) {
    issuesPanel.value?.fetchEvents()
  }
})

const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
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
  queue: 'Queue',
  history: 'History',
  events: 'Events',
}

const tabs = computed<TabItem[]>(() => [
  { key: 'monitoring', label: 'Monitoring', href: '/downloads/monitoring' },
  { key: 'merge', label: 'Ready to merge', href: '/downloads/merge', count: readyCount.value, countHighlight: true },
  // Active only, on purpose: the badge is a "needs attention" count, and rejected rows are settled.
  // Their count is on the tab's own Rejected subtab.
  { key: 'queue', label: 'Queue', href: '/downloads/queue', count: queueActive.value.length, countHighlight: true },
  { key: 'history', label: 'History', href: '/downloads/history' },
  { key: 'events', label: 'Events', href: '/downloads/events', count: monitorCounts.value.flagged, countHighlight: true },
])

const cleanupBusy = ref(false)
const cleanup = async () => {
  cleanupBusy.value = true
  try {
    const r = await store.cleanupReady()
    const parts = []
    if (r.removed) {parts.push(`${r.removed} orphaned ready release${r.removed === 1 ? '' : 's'}`)}
    if (r.danglingRemoved) {parts.push(`${r.danglingRemoved} stale download row${r.danglingRemoved === 1 ? '' : 's'}`)}
    toast.success(parts.length ? `Removed ${parts.join(' + ')}` : `No orphans — all ${r.checked} ready release${r.checked === 1 ? '' : 's'} have their files`)
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

onMounted(async () => {
  store.checkStatus()
  fetchMonitorCounts()
  // One-shot queue read: fetchQueue self-starts the live poll only if there's work to watch (in-flight
  // downloads, or acquisition possible). When idle/paused it stays off until a source is enabled or the
  // page is reloaded — no endless /queue hammering.
  store.fetchQueue()
  // One-shot merge-progress read: only start the merge poll loop if a merge is already running
  // server-side (e.g. after a refresh mid-merge). Otherwise nothing polls merge-progress until the
  // user starts a merge.
  await store.fetchMergeProgress()
  if (store.mergeActive) {
    store.startMergePolling()
  }
})
onUnmounted(() => {
  store.stopQueuePolling()
  store.stopMergePolling()
})
</script>

<template>
  <TabShell :breadcrumb-root="breadcrumbRoot" :breadcrumb-labels="breadcrumbLabels" :tabs="tabs">
    <template #header>
      <div :class="cx(layout.page)">
        <PageTitle text="Downloads" />

        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span class="text-base text-stone-100/60">
              Monitoring <span class="font-semibold text-stone-100">{{ monitoredArtists.toLocaleString() }}</span>/{{ totalArtists.toLocaleString() }} artists
            </span>
          </div>
          <div class="flex items-center gap-2">
            <UiButton
              size="sm"
              :variant="paused ? 'primary' : 'secondary'"
              :icon="paused ? Play : Pause"
              :loading="pauseBusy"
              :title="paused ? 'Resume all downloads' : 'Pause all downloads'"
              @click="togglePause"
            >
              {{ paused ? 'Continue all downloads' : 'Pause all downloads' }}
            </UiButton>
            <UiButton size="sm" variant="secondary" :icon="Brush" :loading="cleanupBusy" title="Remove orphaned ready releases" @click="cleanup">
              Cleanup
            </UiButton>
          </div>
        </div>

        <UiBanner v-if="paused" :tone="pausedReason === 'disk-full' ? 'danger' : 'accent'" :icon="AlertTriangle">
          <template v-if="pausedReason === 'disk-full'">
            Downloads auto-paused — disk full ({{ freeGb }} GB free, need {{ minFreeGb }} GB). Free space, then Continue.
          </template>
          <template v-else>All downloads paused. New downloads, catalogue scans and auto-merge are halted until you continue.</template>
        </UiBanner>

        <DownloadsAcquisitionIdleBanner />

        <DownloadsEnrichmentStalledBanner />

        <DownloadsRecentIssuesPanel ref="issuesPanel" />

        <p v-if="actionMsg" class="rounded-lg border border-stone-100/6 bg-stone-900 px-4 py-2 text-base text-stone-100/60">
          {{ actionMsg }}
        </p>

        <DownloadsDownloadProgress v-if="downloading.length" :items="downloadProgressItems" class="rounded-xl border border-stone-100/6 bg-stone-900 px-4 py-3" />

        <UiLoadingPanel
          v-if="mergeActive && !settings.showTerminal"
          :label="mergeLabel ?? `Merging ${mergingIds.size} release${mergingIds.size !== 1 ? 's' : ''}…`"
          :percent="mergePercent"
          variant="success"
          class="rounded-xl border border-stone-100/6 bg-stone-900 px-4 py-3"
        />
      </div>
    </template>

    <slot />
  </TabShell>
</template>
