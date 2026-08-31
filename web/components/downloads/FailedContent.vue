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
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))
const items = computed(() => filterQueue(failed.value, search.value))

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

const rejectAll = () => askBulkReject(failed.value.map(i => i.id))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search failed…" />
      <UiButton v-if="failed.length" size="sm" variant="danger" :icon="Trash2" :loading="bulkBusy" title="Reject all failed downloads" @click="rejectAll">
        Reject all ({{ failed.length }})
      </UiButton>
    </div>

    <DownloadsSelectionBar
      :count="selected.size"
      :loading="bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
      @cancel="selected = new Set()"
    />

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
      :title="`${bulkRejectIds.length} failed download${bulkRejectIds.length === 1 ? '' : 's'}`"
      @confirm="confirmBulkReject"
    />
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
