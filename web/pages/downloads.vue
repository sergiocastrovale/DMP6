<script setup lang="ts">
import { Check, Trash2, FolderInput, Radar } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import type { DownloadedReleaseItem } from '~/types/download'

useHead({ title: 'Downloads' })

const route = useRoute()
const store = useDownloadsStore()
const { queueActive, queueReady, queueHistory, pendingCount, readyCount } = storeToRefs(store)

const tab = ref<'pending' | 'merge' | 'downloading' | 'failed' | 'history'>('pending')
const busyId = ref<string | null>(null)
const highlightId = ref<string | null>((route.query.highlight as string) || null)

// Deep-link: ?highlight=<downloadedReleaseId> -> pick its tab, scroll + flash the row.
let highlightApplied = false
watch([queueActive, queueReady, queueHistory], () => {
  if (!highlightId.value || highlightApplied) return
  const inActive = queueActive.value.find(i => i.id === highlightId.value)
  const inReady = queueReady.value.find(i => i.id === highlightId.value)
  const inHistory = queueHistory.value.find(i => i.id === highlightId.value)
  if (!inActive && !inReady && !inHistory) return
  highlightApplied = true
  if (inActive) tab.value = inActive.status === 'PENDING' ? 'pending' : (inActive.status === 'FAILED' || inActive.status === 'ABANDONED') ? 'failed' : 'downloading'
  else if (inReady) tab.value = 'merge'
  else tab.value = 'history'
  setTimeout(() => { highlightId.value = null }, 4000)
}, { immediate: true })
const actionMsg = ref<string | null>(null)

const pending = computed(() => queueActive.value.filter(i => i.status === 'PENDING'))
const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
const downloadProgressItems = computed(() => downloading.value.map(i => ({
  status: i.status, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes,
})))
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))
const ready = computed(() => queueReady.value)

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  store.fetchQueue()
  poll = setInterval(() => store.fetchQueue(), 2000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })

const approve = async (id: string) => {
  busyId.value = id
  try { await store.approve(id) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Approve failed' }
  finally { busyId.value = null }
}
const rejectId = ref<string | null>(null)
const rejectOpen = ref(false)
const rejectTitle = computed(() => queueActive.value.find(i => i.id === rejectId.value)?.title ?? null)

const reject = (id: string) => {
  rejectId.value = id
  rejectOpen.value = true
}
const confirmReject = async () => {
  const id = rejectId.value
  rejectOpen.value = false
  if (!id) return
  busyId.value = id
  try { await store.reject(id) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Reject failed' }
  finally { busyId.value = null; rejectId.value = null }
}

const retry = async (id: string) => {
  busyId.value = id
  try { await store.retry(id) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Retry failed' }
  finally { busyId.value = null }
}
const merge = async (id: string) => {
  busyId.value = id
  try { await store.merge(id) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Merge failed' }
  finally { busyId.value = null }
}

const monitorBusy = ref(false)
const monitorAll = async (on: boolean) => {
  monitorBusy.value = true
  try {
    const r = await store.monitorAll(on)
    actionMsg.value = `${on ? 'Monitoring' : 'Stopped monitoring'} ${r.count} artists`
  }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Monitor-all failed' }
  finally { monitorBusy.value = false }
}

const bulkBusy = ref(false)
const approveAll = async () => {
  bulkBusy.value = true
  try { await store.approveAll(pending.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Approve all failed' }
  finally { bulkBusy.value = false }
}
const rejectAllOpen = ref(false)
const confirmRejectAll = async () => {
  rejectAllOpen.value = false
  bulkBusy.value = true
  try { await store.rejectAll(failed.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Reject all failed' }
  finally { bulkBusy.value = false }
}
const mergeAll = async () => {
  bulkBusy.value = true
  try { await store.mergeAll(ready.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Merge all failed' }
  finally { bulkBusy.value = false }
}

// Info dialog: reuse ArtistReleaseInfoDialog by mapping the download row to a partial UnifiedRelease.
const infoItem = ref<DownloadedReleaseItem | null>(null)
const showInfo = ref(false)
const openInfo = (id: string) => {
  infoItem.value = queueActive.value.find(i => i.id === id) ?? queueReady.value.find(i => i.id === id) ?? queueHistory.value.find(i => i.id === id) ?? null
  if (infoItem.value) showInfo.value = true
}
const infoRelease = computed<UnifiedRelease | null>(() => {
  const it = infoItem.value
  if (!it) return null
  return {
    id: it.id,
    title: it.title,
    year: it.year,
    type: it.releaseType ?? '',
    folderPath: it.stagingPath,
    format: it.quality,
    releaseGroupId: it.releaseGroupId,
    localReleaseId: it.localReleaseId,
  } as unknown as UnifiedRelease
})

const tabs = computed(() => [
  { key: 'pending', label: `Pending approval (${pendingCount.value})` },
  { key: 'merge', label: `Ready to merge (${readyCount.value})` },
  { key: 'downloading', label: `Downloading (${downloading.value.length})` },
  { key: 'failed', label: `Failed (${failed.value.length})` },
  { key: 'history', label: 'History' },
])
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold text-ink">Downloads</h1>
        <p class="text-sm text-ink-3">
          Automatic Soulseek acquisitions for monitored artists. Approved releases wait in
          “Ready to merge” until you merge them into the library.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton size="sm" variant="primary" :icon="Radar" :loading="monitorBusy" @click="monitorAll(true)">
          Monitor all
        </UiButton>
        <UiButton size="sm" variant="secondary" :loading="monitorBusy" @click="monitorAll(false)">
          Monitor none
        </UiButton>
      </div>
    </div>

    <p v-if="actionMsg" class="rounded-lg border border-rule bg-bg-1 px-4 py-2 text-sm text-ink-2">
      {{ actionMsg }}
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

    <div v-if="tab === 'pending'" class="space-y-3">
      <div v-if="pending.length" class="flex justify-end">
        <UiButton size="sm" variant="primary" :icon="Check" :loading="bulkBusy" @click="approveAll">
          Approve all ({{ pending.length }})
        </UiButton>
      </div>
      <DownloadsApprovalQueue
        :items="pending"
        :busy-id="busyId"
        :show-actions="true"
        :show-approve="true"
        :highlight-id="highlightId"
        @approve="approve"
        @reject="reject"
        @info="openInfo"
      />
    </div>

    <div v-else-if="tab === 'merge'" class="space-y-3">
      <div v-if="ready.length" class="flex justify-end">
        <UiButton size="sm" variant="primary" :icon="FolderInput" :loading="bulkBusy" @click="mergeAll">
          Merge all ({{ ready.length }})
        </UiButton>
      </div>
      <DownloadsApprovalQueue
        :items="ready"
        :busy-id="busyId"
        :show-actions="true"
        :show-merge="true"
        :highlight-id="highlightId"
        @merge="merge"
        @reject="reject"
        @info="openInfo"
      />
    </div>

    <DownloadsApprovalQueue
      v-else-if="tab === 'downloading'"
      :items="downloading"
      :busy-id="busyId"
      :show-actions="false"
      :highlight-id="highlightId"
      @info="openInfo"
    />

    <div v-else-if="tab === 'failed'" class="space-y-3">
      <div v-if="failed.length" class="flex justify-end">
        <UiButton size="sm" variant="danger" :icon="Trash2" :loading="bulkBusy" @click="rejectAllOpen = true">
          Reject all ({{ failed.length }})
        </UiButton>
      </div>
      <DownloadsApprovalQueue
        :items="failed"
        :busy-id="busyId"
        :show-actions="true"
        :show-retry="true"
        :highlight-id="highlightId"
        @approve="approve"
        @reject="reject"
        @retry="retry"
        @info="openInfo"
      />
    </div>

    <DownloadsApprovalQueue
      v-else
      :items="queueHistory"
      :show-actions="false"
      :highlight-id="highlightId"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <DownloadsRejectDialog
      v-model="rejectAllOpen"
      :title="`all ${failed.length} failed download${failed.length === 1 ? '' : 's'}`"
      @confirm="confirmRejectAll"
    />
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
