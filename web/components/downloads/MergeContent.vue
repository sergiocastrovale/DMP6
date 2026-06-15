<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { FolderInput } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, actionMsg, merge, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueReady } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const items = computed(() => filterQueue(queueReady.value, search.value))

const bulkBusy = ref(false)
const mergeAll = async () => {
  bulkBusy.value = true
  try { await store.mergeAll(queueReady.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Merge all failed' }
  finally { bulkBusy.value = false }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search ready to merge…" />
      <UiButton v-if="queueReady.length" size="sm" variant="primary" :icon="FolderInput" :loading="bulkBusy" @click="mergeAll">
        Merge all ({{ queueReady.length }})
      </UiButton>
    </div>

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-actions="true"
      :show-merge="true"
      :highlight-id="highlightId"
      @merge="merge"
      @reject="reject"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
