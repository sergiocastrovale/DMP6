<script setup lang="ts">
import { Search, RefreshCw } from 'lucide-vue-next'

useHead({ title: 'Downloads' })

const route = useRoute()
const store = useDownloadsStore()
const { queueActive, queueHistory, pendingCount } = storeToRefs(store)

const tab = ref<'pending' | 'downloading' | 'failed' | 'history'>('pending')
const busyId = ref<string | null>(null)
const highlightId = ref<string | null>((route.query.highlight as string) || null)

// Deep-link: ?highlight=<downloadedReleaseId> -> pick its tab, scroll + flash the row.
let highlightApplied = false
watch([queueActive, queueHistory], () => {
  if (!highlightId.value || highlightApplied) return
  const inActive = queueActive.value.find(i => i.id === highlightId.value)
  const inHistory = queueHistory.value.find(i => i.id === highlightId.value)
  if (!inActive && !inHistory) return
  highlightApplied = true
  if (inActive) tab.value = inActive.status === 'PENDING' ? 'pending' : (inActive.status === 'FAILED' || inActive.status === 'ABANDONED') ? 'failed' : 'downloading'
  else tab.value = 'history'
  setTimeout(() => { highlightId.value = null }, 4000)
}, { immediate: true })
const scanning = ref(false)
const scanLimit = ref(10)
const scanMsg = ref<string | null>(null)

const pending = computed(() => queueActive.value.filter(i => i.status === 'PENDING'))
const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
const downloadProgressItems = computed(() => downloading.value.map(i => ({
  status: i.status, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes,
})))
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  store.fetchQueue()
  poll = setInterval(() => store.fetchQueue(), 2000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })

const approve = async (id: string) => {
  busyId.value = id
  try { await store.approve(id) }
  catch (e: any) { scanMsg.value = e?.data?.message || e?.message || 'Approve failed' }
  finally { busyId.value = null }
}
const reject = async (id: string) => {
  busyId.value = id
  try { await store.reject(id) }
  catch (e: any) { scanMsg.value = e?.data?.message || e?.message || 'Reject failed' }
  finally { busyId.value = null }
}

const runScan = async () => {
  scanning.value = true
  scanMsg.value = null
  try {
    const res = await store.scanMissing(scanLimit.value)
    scanMsg.value = `Scanned ${res.scanned} missing · queued ${res.queued} · skipped ${res.skipped} · no result ${res.noResult}`
    tab.value = 'downloading'
  }
  catch (e: any) {
    scanMsg.value = e?.data?.message || e?.message || 'Scan failed'
  }
  finally { scanning.value = false }
}

const tabs = computed(() => [
  { key: 'pending', label: `Pending approval (${pendingCount.value})` },
  { key: 'downloading', label: `Downloading (${downloading.value.length})` },
  { key: 'failed', label: `Failed (${failed.value.length})` },
  { key: 'history', label: 'History' },
])
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold text-ink">Downloads</h1>
        <p class="text-sm text-ink-3">
          Soulseek acquisitions for missing releases. Review and approve before they join the library.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model.number="scanLimit"
          type="number"
          min="1"
          max="100"
          class="w-16 rounded-lg border border-rule bg-bg-1 px-2 py-1.5 text-sm text-ink"
          aria-label="Scan limit"
        >
        <UiButton :icon="Search" :loading="scanning" @click="runScan">
          Scan missing
        </UiButton>
        <UiButton variant="secondary" :icon="RefreshCw" icon-only aria-label="Refresh" @click="store.fetchQueue()" />
      </div>
    </div>

    <p v-if="scanMsg" class="rounded-lg border border-rule bg-bg-1 px-4 py-2 text-sm text-ink-2">
      {{ scanMsg }}
    </p>

    <DownloadsDownloadProgress v-if="downloading.length" :items="downloadProgressItems" class="rounded-lg border border-rule bg-bg-1 px-4 py-3" />

    <div class="flex gap-1 border-b border-rule">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="border-b-2 px-3 py-2 text-sm transition-colors"
        :class="tab === t.key ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink'"
        @click="tab = (t.key as typeof tab)"
      >
        {{ t.label }}
      </button>
    </div>

    <DownloadsApprovalQueue
      v-if="tab === 'pending'"
      :items="pending"
      :busy-id="busyId"
      :show-actions="true"
      :highlight-id="highlightId"
      @approve="approve"
      @reject="reject"
    />
    <DownloadsApprovalQueue
      v-else-if="tab === 'downloading'"
      :items="downloading"
      :busy-id="busyId"
      :show-actions="false"
      :highlight-id="highlightId"
    />
    <DownloadsApprovalQueue
      v-else-if="tab === 'failed'"
      :items="failed"
      :busy-id="busyId"
      :show-actions="true"
      :highlight-id="highlightId"
      @approve="approve"
      @reject="reject"
    />
    <DownloadsApprovalQueue
      v-else
      :items="queueHistory"
      :show-actions="false"
      :highlight-id="highlightId"
    />
  </div>
</template>
