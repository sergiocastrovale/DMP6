<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, cancel, cancelOpen, cancelTitle, confirmCancel,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const downloading = computed(() => queueActive.value.filter(i => i.status === 'DOWNLOADING' || i.status === 'ENRICHING'))
const items = computed(() => filterQueue(downloading.value, search.value))
</script>

<template>
  <div class="flex flex-col gap-4">
    <SearchInput v-model="search" placeholder="Search downloading…" />

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-actions="false"
      :show-cancel="true"
      :highlight-id="highlightId"
      @cancel="cancel"
      @info="openInfo"
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
