<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { X, Loader2, AlertCircle, AlertTriangle, Ban, RotateCw, Info, FolderInput, SearchX, FileX, Undo2 } from 'lucide-vue-next'
import type { DownloadedReleaseItem } from '~/types/download'
import type { SortDirection } from '~/types/common'
import { formatDate, sortItems } from '~/helpers/functions'
import { toneText, surface, cx, typography, ICON_STROKE_WIDTH, data } from '~/helpers/ui'

// Friendly source label, tied to DownloadedRelease.source (SLSKD | RUTRACKER).
const sourceLabel = (s: string) => s === 'RUTRACKER' ? 'RuTracker' : 'Soulseek'

const props = withDefaults(defineProps<{
  items: DownloadedReleaseItem[]
  busyId?: string | null
  busyIds?: Set<string>
  showActions?: boolean
  showRetry?: boolean
  showMerge?: boolean
  showCancel?: boolean
  showRequeue?: boolean
  highlightId?: string | null
  selectable?: boolean
  selected?: Set<string>
}>(), {
  busyIds: () => new Set(),
  selected: () => new Set(),
})

const emit = defineEmits<{
  reject: [id: string]
  retry: [id: string]
  requeue: [id: string]
  merge: [id: string]
  cancel: [id: string]
  info: [id: string]
  'update:selected': [Set<string>]
}>()

// Client-side column sort (the queue is fully loaded in the store, so no server round-trip needed).
const sortKey = ref<string | null>(null)
const sortDir = ref<SortDirection>('asc')

const sortAccessors: Record<string, (i: DownloadedReleaseItem) => string | number | null | undefined> = {
  artist: i => i.artist,
  title: i => i.title,
  releaseType: i => i.releaseType,
  source: i => i.source,
  status: i => i.status,
  updatedAt: i => i.updatedAt,
}

const onSort = (key: string) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const sortedItems = computed(() =>
  sortKey.value && sortAccessors[sortKey.value]
    ? sortItems(props.items, sortAccessors[sortKey.value]!, sortDir.value)
    : props.items,
)

const allChecked = computed(() =>
  props.items.length > 0 && props.items.every(i => props.selected.has(i.id)),
)

const toggleAll = () => {
  const next = new Set(props.selected)
  if (allChecked.value) {
    props.items.forEach(i => next.delete(i.id))
  }
  else {
    props.items.forEach(i => next.add(i.id))
  }
  emit('update:selected', next)
}

const toggleRow = (id: string) => {
  const next = new Set(props.selected)
  if (next.has(id)) {
    next.delete(id)
  }
  else {
    next.add(id)
  }
  emit('update:selected', next)
}

// The one status→tone map for this queue - DOWNLOADING used to render blue text next to an amber
// progress bar (DownloadsDownloadProgress's own status-to-variant map), a real contradiction, not
// just an inconsistent shade. Both now read the same tone here.
//
// This is deliberately not identical to handoff/vue/DmpStatusLabel.vue's generic map, which puts
// DOWNLOADING on `info`: the reference *screen* (handoff/screenshots/10-downloads.png) shows
// "downloading" amber above an amber bar and "enriching" violet above a violet bar, and the screen
// wins over the standalone primitive. UNAVAILABLE and INVALID follow the primitive - "no source
// found yet, retried automatically" is a warning rather than a shrug, and an invalid merge is a
// failure the same way a failed download is.
const STATUS_TONE: Record<string, keyof typeof toneText> = {
  DOWNLOADING: 'accent',
  ENRICHING: 'info',
  READY: 'success',
  PROMOTED: 'success',
  FAILED: 'danger',
  ABANDONED: 'danger',
  REJECTED: 'muted',
  UNAVAILABLE: 'warning',
  INVALID: 'danger',
}
const statusClass = (s: string) => toneText[STATUS_TONE[s] ?? 'muted']

const { songkong } = storeToRefs(useDownloadsStore())

// What the hover on the status cell says. FAILED rows have `error`; ENRICHING rows have nothing at all,
// and "enriching" on its own never explained why a row could sit there for half an hour - enrichment
// runs outside dmp, on a host cron, so a dead cron looks identical to a slow one from here.
const statusNote = (it: DownloadedReleaseItem): string | null => {
  if (it.error) {
    return it.error
  }
  if (it.status !== 'ENRICHING') {
    return null
  }
  const maxWait = songkong.value?.maxWaitMin ?? 30
  return songkong.value?.stalled
    ? `Waiting for SongKong, but nothing is draining the queue (${songkong.value.spoolCount} album(s) spooled). This merges without enrichment ${maxWait} min after it was spooled.`
    : `Waiting for SongKong to tag this album — it runs on a host cron every 2 min. Merges without enrichment if it takes longer than ${maxWait} min.`
}

const statusLabel = (it: DownloadedReleaseItem) => {
  if (it.status === 'ABANDONED') {
    return `gave up${it.attempts ? ` (${it.attempts} tries)` : ''}`
  }
  if (it.status === 'UNAVAILABLE') {
    return `unavailable${it.attempts ? ` (${it.attempts} tries)` : ''}`
  }
  if (it.status === 'INVALID') {
    return `invalid${it.attempts ? ` (${it.attempts} tries)` : ''}`
  }
  return it.status.toLowerCase()
}
</script>

<template>
  <UiEmptyState v-if="items.length === 0" message="Nothing here." />
  <SlimTable v-else>
    <SlimTableHeader>
      <th v-if="selectable" :class="cx(data.th, 'w-10')">
        <UiCheckbox :model-value="allChecked" aria-label="Select all rows" @update:model-value="toggleAll" />
      </th>
      <SortableTh label="Artist" sort-key="artist" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <SortableTh label="Release" sort-key="title" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <SortableTh label="Type" sort-key="releaseType" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <SortableTh label="Source" sort-key="source" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <SortableTh label="Status" sort-key="status" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <SortableTh label="Updated" sort-key="updatedAt" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
      <th :class="cx(data.th, 'text-right')">Actions</th>
    </SlimTableHeader>
    <SlimTableBody>
      <SlimTableRow
        v-for="it in sortedItems"
        :key="it.id"
        :active="selected.has(it.id)"
        :highlight="highlightId === it.id"
        :class="highlightId === it.id ? 'ring-2 ring-inset ring-amber-400/60' : ''"
      >
        <td v-if="selectable" :class="data.td" @click.stop>
          <UiCheckbox :model-value="selected.has(it.id)" :aria-label="`Select ${it.title}`" @update:model-value="toggleRow(it.id)" />
        </td>
        <td :class="cx(data.td, 'text-stone-100')">
          <NuxtLink v-if="it.artistSlug" :to="`/artist/${it.artistSlug}`" class="hover:text-amber-400 transition-colors duration-150">
            {{ it.artist || '—' }}
          </NuxtLink>
          <span v-else>{{ it.artist || '—' }}</span>
        </td>
        <td :class="cx(data.td, 'text-stone-100/60')">
          {{ it.title }}<span v-if="it.year" class="text-stone-100/55"> ({{ it.year }})</span>
        </td>
        <td :class="cx(data.td, 'text-stone-100/55')">
          {{ it.releaseType || '—' }}
        </td>
        <td :class="cx(data.td, 'text-amber-400/80')">
          <span class="inline-flex items-center gap-1.5">
            {{ sourceLabel(it.source) }}
          </span>
          <template v-if="it.quality"> · {{ it.quality }}</template>
          <template v-if="it.slskUsername"> · {{ it.slskUsername }}</template>
        </td>
        <td :class="data.td">
          <Popover v-if="statusNote(it)" trigger="hover">
            <template #trigger>
              <span class="inline-flex cursor-help items-center gap-1.5" :class="statusClass(it.status)">
                <Loader2 v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" :size="13" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
                <AlertCircle v-else-if="it.status === 'FAILED'" :size="13" />
                <Ban v-else-if="it.status === 'ABANDONED'" :size="13" />
                <SearchX v-else-if="it.status === 'UNAVAILABLE'" :size="13" />
                <FileX v-else-if="it.status === 'INVALID'" :size="13" />
                {{ statusLabel(it) }}
                <AlertTriangle v-if="it.status === 'ENRICHING' && songkong?.stalled" :size="13" class="text-amber-400" />
              </span>
            </template>
            <template #content>
              <div :class="cx(surface.popover, 'absolute left-0 top-full z-20 mt-1 w-72 p-3')">
                <p class="text-sm text-stone-100/60">{{ statusNote(it) }}</p>
              </div>
            </template>
          </Popover>
          <span v-else class="inline-flex items-center gap-1.5" :class="statusClass(it.status)">
            <Loader2 v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" :size="13" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
            <AlertCircle v-else-if="it.status === 'FAILED'" :size="13" />
            <Ban v-else-if="it.status === 'ABANDONED'" :size="13" />
            <SearchX v-else-if="it.status === 'UNAVAILABLE'" :size="13" />
            <FileX v-else-if="it.status === 'INVALID'" :size="13" />
            {{ statusLabel(it) }}
          </span>
          <div v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" class="mt-1.5 flex items-center gap-2">
            <DownloadsDownloadProgress :percent="it.percent" :status="it.status" class="w-32" />
            <span :class="typography.meta">{{ it.percent }}%</span>
          </div>
        </td>
        <td :class="cx(data.td, 'whitespace-nowrap', typography.meta)">
          {{ formatDate(it.updatedAt) }}
        </td>
        <td :class="data.td" @click.stop>
          <div class="flex items-center justify-end gap-1">
            <UiButton
              variant="ghost"
              size="sm"
              icon-only
              :icon="Info"
              title="Info"
              aria-label="Info"
              @click="emit('info', it.id)"
            />
            <UiButton
              v-if="showActions && showRetry"
              variant="ghost"
              size="sm"
              icon-only
              :icon="RotateCw"
              :loading="busyId === it.id"
              :disabled="busyId != null && busyId !== it.id"
              title="Force retry"
              aria-label="Force retry"
              @click="emit('retry', it.id)"
            />
            <UiButton
              v-if="showMerge"
              variant="ghost"
              size="sm"
              icon-only
              :icon="FolderInput"
              :loading="busyIds.has(it.id)"
              :disabled="busyIds.has(it.id)"
              title="Merge into library"
              aria-label="Merge"
              @click="emit('merge', it.id)"
            />
            <UiButton
              v-if="showCancel && (it.status === 'DOWNLOADING' || it.status === 'ENRICHING')"
              variant="danger"
              size="sm"
              icon-only
              :icon="X"
              :loading="busyId === it.id"
              :disabled="busyId != null && busyId !== it.id"
              title="Cancel download"
              aria-label="Cancel download"
              @click="emit('cancel', it.id)"
            />
            <UiButton
              v-if="showRequeue"
              variant="ghost"
              size="sm"
              icon-only
              :icon="Undo2"
              :loading="busyId === it.id"
              :disabled="busyId != null && busyId !== it.id"
              title="Move back to queue"
              aria-label="Move back to queue"
              @click="emit('requeue', it.id)"
            />
            <UiButton
              v-if="showActions"
              variant="danger"
              size="sm"
              icon-only
              :icon="X"
              :disabled="busyId != null || it.status === 'DOWNLOADING'"
              title="Reject"
              aria-label="Reject"
              @click="emit('reject', it.id)"
            />
          </div>
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>
</template>
