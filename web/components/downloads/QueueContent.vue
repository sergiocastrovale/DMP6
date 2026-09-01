<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { RotateCw, Trash2, Undo2 } from 'lucide-vue-next'
import type { DownloadedReleaseItem } from '~/types/download'
import type { SubtabItem, BarAction } from '~/types/ui'
import { queueFilters } from '~/helpers/constants'
import { filterQueue, canRetryDownload, canRejectDownload, canRequeueDownload } from '~/helpers/functions'

const {
  store, busyId,
  retry, retryMany, requeue, requeueAll,
  reject, rejectOpen, rejectTitle, confirmReject,
  bulkBusy, bulkRejectIds, bulkRejectOpen, askBulkReject, confirmBulkReject,
  cancel, cancelOpen, cancelTitle, confirmCancel,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive, queueRejected } = storeToRefs(store)
const highlightId = useHighlightId()
const route = useRoute()
const router = useRouter()

const DEFAULT_FILTER = 'all'

const search = ref('')
const selected = ref<Set<string>>(new Set())
const filter = ref(
  queueFilters.some(f => f.key === route.query.filter) ? String(route.query.filter) : DEFAULT_FILTER,
)

// The filter lives in the URL so "Verify download" (helpers/functions.ts's downloadSubpage) and a
// browser reload both land on the same slice. Selection is dropped on every switch: a bulk action
// derives its verbs from the selected rows, and carrying a hidden selection across filters would run
// it on rows the user can no longer see.
watch(filter, (key) => {
  selected.value = new Set()
  router.replace({ query: { ...route.query, filter: key === DEFAULT_FILTER ? undefined : key } })
})

const all = computed(() => [...queueActive.value, ...queueRejected.value])
const inFilter = (items: DownloadedReleaseItem[], key: string) => {
  const statuses = queueFilters.find(f => f.key === key)?.statuses ?? []
  return statuses.length ? items.filter(i => statuses.includes(i.status)) : items
}

const visible = computed(() => inFilter(all.value, filter.value))
const items = computed(() => filterQueue(visible.value, search.value))

const tabs = computed<SubtabItem[]>(() => queueFilters.map(f => ({
  key: f.key,
  label: f.label,
  count: inFilter(all.value, f.key).length,
})))

const selectedItems = computed(() => all.value.filter(i => selected.value.has(i.id)))
const retryable = computed(() => visible.value.filter(i => canRetryDownload(i.status)))
const requeueable = computed(() => visible.value.filter(i => canRequeueDownload(i.status)))

const bulkActions = computed<BarAction[]>(() => {
  const actions: BarAction[] = []
  if (selectedItems.value.some(i => canRetryDownload(i.status))) {
    actions.push({ key: 'retry', label: 'Retry', icon: RotateCw, variant: 'quiet' })
  }
  if (selectedItems.value.some(i => canRequeueDownload(i.status))) {
    actions.push({ key: 'requeue', label: 'Move to queue', icon: Undo2, variant: 'quiet' })
  }
  if (selectedItems.value.some(i => canRejectDownload(i.status))) {
    actions.push({ key: 'reject', label: 'Reject', icon: Trash2, variant: 'danger' })
  }
  return actions
})

const idsWhere = (predicate: (status: string) => boolean) =>
  selectedItems.value.filter(i => predicate(i.status)).map(i => i.id)

const onBulkAction = (key: string) => {
  const ids = key === 'retry'
    ? idsWhere(canRetryDownload)
    : key === 'requeue' ? idsWhere(canRequeueDownload) : idsWhere(canRejectDownload)
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  if (key === 'retry') {
    retryMany(ids)
    return
  }
  if (key === 'requeue') {
    requeueAll(ids)
    return
  }
  askBulkReject(ids)
}

const rejectAll = () => askBulkReject(retryable.value.map(i => i.id))
const requeueAllVisible = () => requeueAll(requeueable.value.map(i => i.id))
const clearSelection = () => {
  selected.value = new Set()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Subtabs v-model="filter" :tabs="tabs" />

    <p v-if="filter === 'unavailable'" class="text-base text-stone-100/55">
      No Soulseek source found yet. These aren’t failures — they sink in priority and are retried
      automatically when slots free up. Force a retry to push one back to the front of the queue.
    </p>

    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search queue…" />
      <div class="flex items-center gap-2">
        <UiButton
          v-if="requeueable.length"
          size="sm"
          :icon="Undo2"
          title="Move all rejected downloads back to queue"
          @click="requeueAllVisible"
        >
          Move all back to queue ({{ requeueable.length }})
        </UiButton>
        <UiButton
          v-if="retryable.length"
          size="sm"
          variant="danger"
          :icon="Trash2"
          :loading="bulkBusy"
          title="Reject all failed and unavailable downloads"
          @click="rejectAll"
        >
          Reject all ({{ retryable.length }})
        </UiButton>
      </div>
    </div>

    <DownloadsSelectionBar
      :count="selected.size"
      :loading="bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
      @cancel="clearSelection"
    />

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      auto
      :highlight-id="highlightId"
      selectable
      :selected="selected"
      @update:selected="selected = $event"
      @reject="reject"
      @retry="retry"
      @requeue="requeue"
      @cancel="cancel"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <DownloadsRejectDialog
      v-model="bulkRejectOpen"
      :title="`${bulkRejectIds.length} download${bulkRejectIds.length === 1 ? '' : 's'}`"
      @confirm="confirmBulkReject"
    />
    <DownloadsRejectDialog
      v-model="cancelOpen"
      :title="cancelTitle"
      heading="Cancel download"
      verb="Cancel the download of"
      confirm-label="Cancel & delete"
      @confirm="confirmCancel"
    />
    <ReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
