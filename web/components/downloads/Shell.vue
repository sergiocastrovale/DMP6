<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Brush, Pause, Play } from 'lucide-vue-next'
import type { TabItem } from '~/types/ui'
import { cx, layout } from '~/helpers/ui'

const store = useDownloadsStore()
const toast = useToastStore()
const { queueActive, readyCount, paused, mergeActive, mergeBatchTotal, mergeBatchCompleted, mergePercent, environmentBlockReasons, monitoredArtists, totalArtists } = storeToRefs(store)

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

// Server-polled (store.mergeBatchTotal/mergePercent), not tied to the merge-stream SSE connection -
// stays accurate across the page even if that stream drops mid-batch (see mergeProgress in
// stores/downloads.ts).
const mergeLabel = computed(() => {
  const n = mergeBatchTotal.value
  return `Merging ${n} release${n === 1 ? '' : 's'} — ${mergeBatchCompleted.value}/${n} done`
})

const tabs = computed<TabItem[]>(() => [
  { key: 'monitoring', label: 'Monitoring', href: '/downloads/monitoring' },
  { key: 'merge', label: 'Ready to merge', href: '/downloads/merge', count: readyCount.value, countHighlight: true },
  // Active only, on purpose: the badge is a "needs attention" count, and rejected rows are settled.
  // Their count is on the tab's own Rejected subtab.
  { key: 'queue', label: 'Queue', href: '/downloads/queue', count: queueActive.value.length, countHighlight: true },
  { key: 'history', label: 'History', href: '/downloads/history' },
  { key: 'events', label: 'Events', href: '/downloads/events', count: monitorCounts.value.flagged, countHighlight: true },
])

const monitoringCount = computed(() => `${monitoredArtists.value.toLocaleString()}/${totalArtists.value.toLocaleString()} artists`)

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

onMounted(() => {
  store.checkStatus()
  store.fetchDownloadCapabilities()
  store.fetchMonitorCounts()
  // One-shot queue read: fetchQueue self-starts the live poll only if there's work to watch (in-flight
  // downloads, or acquisition possible). When idle/paused it stays off until a source is enabled or the
  // page is reloaded — no endless /queue hammering.
  store.fetchQueue()
})

onUnmounted(() => {
  store.stopQueuePolling()
})
</script>

<template>
  <TabShell :tabs="tabs">
    <template #header>
      <div :class="cx(layout.page)">
        <PageTitle text="Downloads" :subtext="`Monitoring ${monitoringCount}`">
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-2">
              <DownloadsDownloadDisabledButton
                :icon="paused ? Play : Pause"
                :label="paused ? 'Resume all downloads' : 'Pause all downloads'"
                :loading="pauseBusy"
                :variant="paused ? 'primary' : 'secondary'"
                :reasons="environmentBlockReasons"
                :icon-only="false"
                @click="togglePause"
              >
                {{ paused ? 'Continue all downloads' : 'Pause all downloads' }}
              </DownloadsDownloadDisabledButton>
              <UiButton size="sm" variant="secondary" :icon="Brush" :loading="cleanupBusy" title="Remove orphaned ready releases" @click="cleanup">
                Cleanup
              </UiButton>
            </div>
          </div>
        </PageTitle>
        <div class="flex flex-col gap-4">
          <DownloadsOperationsUnavailableBanner />

          <DownloadsPausedBanner />

          <DownloadsAcquisitionIdleBanner />

          <DownloadsEnrichmentStalledBanner />

          <DownloadsRecentIssuesPanel ref="issuesPanel" />

          <p v-if="actionMsg" class="rounded-lg border border-stone-100/6 bg-stone-900 px-4 py-2 text-base text-stone-100/60">
            {{ actionMsg }}
          </p>

          <DownloadsDownloadProgress v-if="downloading.length" :items="downloadProgressItems" class="rounded-xl border border-stone-100/6 bg-stone-900 px-4 py-3" />

          <DownloadsDownloadProgress v-if="mergeBatchTotal > 0" :label="mergeLabel" :percent="mergePercent" class="rounded-xl border border-stone-100/6 bg-stone-900 px-4 py-3" />
        </div>
      </div>
    </template>

    <slot />
  </TabShell>
</template>
