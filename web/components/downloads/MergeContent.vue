<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { FolderInput, Trash2 } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, busyIds, actionMsg, merge, reject, rejectOpen, rejectTitle, confirmReject,
  bulkBusy, bulkRejectIds, bulkRejectOpen, askBulkReject, confirmBulkReject,
  bulkMergeIds, bulkMergeOpen, askBulkMerge, confirmBulkMerge,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueReady, mergeActive } = storeToRefs(store)
const toast = useToastStore()
const highlightId = useHighlightId()

const search = ref('')
const items = computed(() => filterQueue(queueReady.value, search.value))

const selected = ref<Set<string>>(new Set())

const artistOptions = computed(() => {
  const names = new Set(queueReady.value.map(i => i.artist).filter((a): a is string => !!a))
  return [...names].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }))
})
const selectedArtist = ref<string | null>(null)
watch(selectedArtist, (artist) => {
  search.value = artist ?? ''
  if (artist) {
    selected.value = new Set(queueReady.value.filter(i => i.artist === artist).map(i => i.id))
  }
})

const mergeAll = async () => {
  try {
    const result = await store.mergeAll(queueReady.value.map(i => i.id))
    if (result?.errors?.length) {
      const n = result.errors.length
      toast.error(`${n} release${n === 1 ? '' : 's'} failed to merge`)
    }
  }
  catch (e: any) {
    actionMsg.value = e?.data?.message || e?.message || 'Merge all failed'
    toast.error(actionMsg.value!)
  }
}

const bulkActions = [
  { key: 'merge', label: 'Merge selected', icon: FolderInput, variant: 'primary' as const },
  { key: 'reject', label: 'Reject selected', icon: Trash2, variant: 'danger' as const },
]

const onBulkAction = (key: string) => {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  key === 'merge' ? askBulkMerge(ids) : askBulkReject(ids)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <SearchInput v-model="search" placeholder="Search ready to merge…" />
        <Dropdown v-model="selectedArtist" :options="artistOptions" placeholder="All artists" />
      </div>
      <UiButton v-if="queueReady.length" size="sm" variant="primary" :icon="FolderInput" :loading="mergeActive" title="Merge all ready releases into the library" @click="mergeAll">
        Merge all ({{ queueReady.length }})
      </UiButton>
    </div>

    <DownloadsSelectionBar
      :count="selected.size"
      :loading="busyIds.size > 0 || bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
      @cancel="selected = new Set()"
    />

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :busy-ids="busyIds"
      :show-actions="true"
      :show-merge="true"
      :highlight-id="highlightId"
      selectable
      :selected="selected"
      @update:selected="selected = $event"
      @merge="merge"
      @reject="reject"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <DownloadsRejectDialog
      v-model="bulkRejectOpen"
      :title="`${bulkRejectIds.length} selected download${bulkRejectIds.length === 1 ? '' : 's'}`"
      @confirm="confirmBulkReject"
    />
    <ConfirmDialog
      v-model="bulkMergeOpen"
      title="Merge selected"
      :message="`Merge ${bulkMergeIds.length} release${bulkMergeIds.length === 1 ? '' : 's'} into the library?`"
      note="Merging re-indexes and re-syncs each release against MusicBrainz — this can take a while for many releases."
      confirm-label="Merge"
      :icon="FolderInput"
      @confirm="confirmBulkMerge"
    />
    <ReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
