<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Trash2 } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, retry, reject, rejectOpen, rejectTitle, confirmReject,
  bulkBusy, bulkRejectIds, bulkRejectOpen, askBulkReject, confirmBulkReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const unavailable = computed(() => queueActive.value.filter(i => i.status === 'UNAVAILABLE'))
const items = computed(() => filterQueue(unavailable.value, search.value))

const selected = ref<Set<string>>(new Set())

const bulkActions = [
  { key: 'reject', label: 'Reject selected', icon: Trash2, variant: 'danger' as const },
]
const onBulkAction = () => {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  askBulkReject(ids)
}

const rejectAll = () => askBulkReject(unavailable.value.map(i => i.id))
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-ink-3">
      No Soulseek source found yet. These aren’t failures — they sink in priority and are retried
      automatically when slots free up. Force a retry to push one back to the front of the queue.
    </p>

    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search unavailable…" />
      <UiButton v-if="unavailable.length" size="sm" variant="danger" :icon="Trash2" :loading="bulkBusy" title="Reject all unavailable downloads" @click="rejectAll">
        Reject all ({{ unavailable.length }})
      </UiButton>
    </div>

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-actions="true"
      :show-retry="true"
      :highlight-id="highlightId"
      selectable
      :selected="selected"
      @update:selected="selected = $event"
      @reject="reject"
      @retry="retry"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <DownloadsRejectDialog
      v-model="bulkRejectOpen"
      :title="`${bulkRejectIds.length} unavailable download${bulkRejectIds.length === 1 ? '' : 's'}`"
      @confirm="confirmBulkReject"
    />
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
    <DownloadsSelectionBar
      :count="selected.size"
      :loading="bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
    />
  </div>
</template>
