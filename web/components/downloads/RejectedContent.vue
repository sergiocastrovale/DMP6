<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Undo2 } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, requeue, requeueAll, openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueRejected } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const items = computed(() => filterQueue(queueRejected.value, search.value))

const selected = ref<Set<string>>(new Set())

const bulkActions = [
  { key: 'requeue', label: 'Move to queue', icon: Undo2 },
]
const onBulkAction = async () => {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  await requeueAll(ids)
}

const moveAllBackToQueue = () => requeueAll(queueRejected.value.map(i => i.id))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search rejected…" />
      <UiButton v-if="queueRejected.length" size="sm" :icon="Undo2" title="Move all rejected downloads back to queue" @click="moveAllBackToQueue">
        Move all back to queue ({{ queueRejected.length }})
      </UiButton>
    </div>

    <DownloadsSelectionBar
      :count="selected.size"
      :actions="bulkActions"
      @action="onBulkAction"
      @cancel="selected = new Set()"
    />

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-requeue="true"
      :highlight-id="highlightId"
      selectable
      :selected="selected"
      @update:selected="selected = $event"
      @requeue="requeue"
      @info="openInfo"
    />

    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
