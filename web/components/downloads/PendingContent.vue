<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Check } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, actionMsg, approve, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const pending = computed(() => queueActive.value.filter(i => i.status === 'PENDING'))
const items = computed(() => filterQueue(pending.value, search.value))

const bulkBusy = ref(false)
const approveAll = async () => {
  bulkBusy.value = true
  try { await store.approveAll(pending.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Approve all failed' }
  finally { bulkBusy.value = false }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search pending…" />
      <UiButton v-if="pending.length" size="sm" variant="primary" :icon="Check" :loading="bulkBusy" @click="approveAll">
        Approve all ({{ pending.length }})
      </UiButton>
    </div>

    <DownloadsApprovalQueue
      :items="items"
      :busy-id="busyId"
      :show-actions="true"
      :show-approve="true"
      :highlight-id="highlightId"
      @approve="approve"
      @reject="reject"
      @info="openInfo"
    />

    <DownloadsRejectDialog v-model="rejectOpen" :title="rejectTitle" @confirm="confirmReject" />
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
