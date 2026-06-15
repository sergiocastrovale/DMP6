<script setup lang="ts">
import { storeToRefs } from 'pinia'
import type { TabItem } from '~/types/ui'
import { filterQueue } from '~/helpers/functions'

const { store, openInfo, showInfo, infoRelease } = useDownloadQueueActions()
const { queueHistory } = storeToRefs(store)
const highlightId = useHighlightId()

const sub = ref('PROMOTED')
const search = ref('')

const counts = computed(() => {
  const c: Record<string, number> = { APPROVED: 0, PROMOTED: 0, ABANDONED: 0, REJECTED: 0 }
  for (const i of queueHistory.value) {
    if (i.status in c) { c[i.status] = (c[i.status] ?? 0) + 1 }
  }
  return c
})
const tabs = computed<TabItem[]>(() => [
  { key: 'PROMOTED', label: 'Promoted', count: counts.value.PROMOTED },
  { key: 'APPROVED', label: 'Approved', count: counts.value.APPROVED },
  { key: 'REJECTED', label: 'Rejected', count: counts.value.REJECTED },
  { key: 'ABANDONED', label: 'Abandoned', count: counts.value.ABANDONED },
])
const items = computed(() => filterQueue(queueHistory.value.filter(i => i.status === sub.value), search.value))

// If deep-linked to a specific row, jump to its status subtab once the queue loads.
let jumped = false
watch(queueHistory, () => {
  if (jumped || !highlightId.value) {
    return
  }
  const row = queueHistory.value.find(i => i.id === highlightId.value)
  if (row) {
    sub.value = row.status
    jumped = true
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <Tabs v-model="sub" :tabs="tabs" />
      <SearchInput v-model="search" placeholder="Search history…" />
    </div>

    <DownloadsApprovalQueue
      :items="items"
      :show-actions="false"
      :highlight-id="highlightId"
      @info="openInfo"
    />

    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
