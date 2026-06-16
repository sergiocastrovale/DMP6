<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, retry, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueActive } = storeToRefs(store)
const highlightId = useHighlightId()

const search = ref('')
const unavailable = computed(() => queueActive.value.filter(i => i.status === 'UNAVAILABLE'))
const items = computed(() => filterQueue(unavailable.value, search.value))
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-ink-3">
      No Soulseek source found yet. These aren’t failures — they sink in priority and are retried
      automatically when slots free up. Force a retry to push one back to the front of the queue.
    </p>

    <div class="flex items-center justify-end">
      <SearchInput v-model="search" placeholder="Search unavailable…" />
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
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
