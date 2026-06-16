<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Trash2 } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, actionMsg, retry, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const failed = computed(() => queueActive.value.filter(i => i.status === 'FAILED' || i.status === 'ABANDONED'))
const items = computed(() => filterQueue(failed.value, search.value))

const bulkBusy = ref(false)
const rejectAllOpen = ref(false)
const confirmRejectAll = async () => {
  rejectAllOpen.value = false
  bulkBusy.value = true
  try { await store.rejectAll(failed.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Reject all failed' }
  finally { bulkBusy.value = false }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search failed…" />
      <UiButton v-if="failed.length" size="sm" variant="danger" :icon="Trash2" :loading="bulkBusy" @click="rejectAllOpen = true">
        Reject all ({{ failed.length }})
      </UiButton>
    </div>

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-actions="true"
      :show-retry="true"
      :highlight-id="highlightId"
      @reject="reject"
      @retry="retry"
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
