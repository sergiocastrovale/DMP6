<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useIntervalFn } from '@vueuse/core'
import { FolderInput } from 'lucide-vue-next'
import { filterQueue } from '~/helpers/functions'

type MergeStep = 'moving' | 'indexing' | 'syncing'
type ProgressMap = Record<string, { step: MergeStep; title: string }>

const STEPS: MergeStep[] = ['moving', 'indexing', 'syncing']
const STEP_LABELS: Record<MergeStep, (title: string) => string> = {
  moving: title => `Moving "${title}" to library…`,
  indexing: title => `Indexing "${title}"…`,
  syncing: title => `Syncing "${title}"…`,
}

const {
  store, busyId, busyIds, actionMsg, merge, mergeMany, reject, rejectOpen, rejectTitle, confirmReject,
  openInfo, showInfo, infoRelease,
} = useDownloadQueueActions()
const { queueReady } = storeToRefs(store)
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

const bulkBusy = ref(false)
const mergeAll = async () => {
  bulkBusy.value = true
  try { await store.mergeAll(queueReady.value.map(i => i.id)) }
  catch (e: any) { actionMsg.value = e?.data?.message || e?.message || 'Merge all failed' }
  finally { bulkBusy.value = false }
}

const mergeTotal = ref(0)
const mergeProgressMap = ref<ProgressMap>({})

const { pause: stopPoll, resume: startPoll } = useIntervalFn(async () => {
  if (!busyIds.value.size) {
    mergeProgressMap.value = {}
    stopPoll()
    return
  }
  try {
    mergeProgressMap.value = await $fetch<ProgressMap>('/api/downloads/merge-progress')
  }
  catch { /* ignore */ }
}, 600, { immediate: false })

watch(() => busyIds.value.size, (size) => {
  if (size > 0) {
    startPoll()
  }
  else {
    stopPoll()
    mergeProgressMap.value = {}
  }
})

const stepIndex = (step: MergeStep) => STEPS.indexOf(step)

const mergeLabel = computed(() => {
  const entries = Object.values(mergeProgressMap.value)
  if (!entries.length) {
    return null
  }
  const highest = entries.reduce((a, b) => stepIndex(a.step) >= stepIndex(b.step) ? a : b)
  return STEP_LABELS[highest.step](highest.title)
})

const mergePercent = computed(() => {
  const total = mergeTotal.value * 3
  if (!total) {
    return 0
  }
  const doneItems = mergeTotal.value - busyIds.value.size
  const doneSteps = doneItems * 3
  const inFlightSteps = Object.values(mergeProgressMap.value)
    .reduce((sum, p) => sum + stepIndex(p.step), 0)
  return Math.round(Math.min((doneSteps + inFlightSteps) / total * 100, 99))
})

const mergeSelected = async () => {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  mergeTotal.value = ids.length
  await mergeMany(ids)
  mergeTotal.value = 0
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <SearchInput v-model="search" placeholder="Search ready to merge…" />
        <Dropdown :options="artistOptions" v-model="selectedArtist" placeholder="All artists" />
      </div>
      <UiButton v-if="queueReady.length" size="sm" variant="primary" :icon="FolderInput" :loading="bulkBusy" @click="mergeAll">
        Merge all ({{ queueReady.length }})
      </UiButton>
    </div>

    <UiLoadingPanel
      v-if="busyIds.size > 0"
      :label="mergeLabel ?? `Merging ${busyIds.size} release${busyIds.size !== 1 ? 's' : ''}…`"
      :percent="mergePercent"
      variant="success"
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
    <ArtistReleaseInfoDialog v-model="showInfo" :release="infoRelease" :extra="null" />
    <DownloadsSelectionBar :count="selected.size" :loading="busyIds.size > 0" @merge="mergeSelected" />
  </div>
</template>
