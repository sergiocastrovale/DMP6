<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { FolderInput } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

const {
  store, busyId, busyIds, actionMsg, merge, mergeMany, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueReady, mergeActive } = storeToRefs(store)
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
  try { await store.mergeAll(queueReady.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Merge all failed' }
}

const mergeSelected = async () => {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  await mergeMany(ids)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <SearchInput v-model="search" placeholder="Search ready to merge…" />
        <Dropdown :options="artistOptions" v-model="selectedArtist" placeholder="All artists" />
      </div>
      <UiButton v-if="queueReady.length" size="sm" variant="primary" :icon="FolderInput" :loading="mergeActive" @click="mergeAll">
        Merge all ({{ queueReady.length }})
      </UiButton>
    </div>

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
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
    <DownloadsSelectionBar :count="selected.size" :loading="busyIds.size > 0" @merge="mergeSelected" />
  </div>
</template>
