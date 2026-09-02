<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { filterQueue } from '~/helpers/functions'

const { store, openInfo, showInfo, infoRelease } = useDownloadQueueActions()
const { queueHistory } = storeToRefs(store)
const highlightId = useHighlightId()

const sub = ref('PROMOTED')
const search = ref('')

// ABANDONED lives only in the Failed tab (still retryable there) - not duplicated here, see
// downloadQueue.ts's fetchHistoryQueueRows.
const counts = computed(() => {
  const c: Record<string, number> = { PROMOTED: 0, INVALID: 0 }
  for (const i of queueHistory.value) {
    if (i.status in c) { c[i.status] = (c[i.status] ?? 0) + 1 }
  }
  return c
})
const tabs = computed(() => [
  { key: 'PROMOTED', label: 'Promoted', count: counts.value.PROMOTED },
  { key: 'INVALID', label: 'Invalid', count: counts.value.INVALID },
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
    <DownloadsTabHint>
      A permanent record of every merge outcome. Promoted releases made it into your library;
      Invalid ones were discarded after a genuine shortfall (see Events for why). Nothing here can
      be retried directly — a discarded release becomes downloadable again on its own.
    </DownloadsTabHint>

    <div class="flex items-center justify-end">
      <SearchInput v-model="search" placeholder="Search history…" />
    </div>

    <Subtabs v-model="sub" :tabs="tabs" />

    <DownloadsApprovalQueue
      :items="items"
      :show-actions="false"
      :highlight-id="highlightId"
      @info="openInfo"
    />

    <ReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
  </div>
</template>
