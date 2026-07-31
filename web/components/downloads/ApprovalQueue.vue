<script setup lang="ts">
import { X, Loader2, AlertCircle, Ban, RotateCw, Info, FolderInput, SearchX, FileX, Undo2 } from 'lucide-vue-next'
import type { DownloadedReleaseItem } from '~/types/download'
import type { SortDir } from '~/helpers/functions'
import { formatDate, sortItems } from '~/helpers/functions'

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

// Scroll the highlighted row into view once it renders.
const rowEls = new Map<string, HTMLElement>()
const setRowEl = (id: string, el: any) => {
  if (el) rowEls.set(id, el as HTMLElement)
  else rowEls.delete(id)
}
watch(
  () => [props.highlightId, props.items.length] as const,
  async () => {
    if (!props.highlightId) return
    await nextTick()
    rowEls.get(props.highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  },
  { immediate: true },
)

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
const sortDir = ref<SortDir>('asc')

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

const statusClass = (s: string) => ({
  DOWNLOADING: 'text-blue-400',
  ENRICHING: 'text-violet-400',
  READY: 'text-emerald-400',
  PROMOTED: 'text-emerald-400',
  REJECTED: 'text-ink-3',
  FAILED: 'text-red-400',
  ABANDONED: 'text-ink-3',
  UNAVAILABLE: 'text-ink-3',
  INVALID: 'text-ink-3',
}[s] || 'text-ink-2')

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
  <div v-if="items.length === 0" class="rounded-lg border border-rule bg-bg-1 p-8 text-center text-sm text-ink-3">
    Nothing here.
  </div>
  <Table v-else>
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-3">
          <th v-if="selectable" class="w-10 px-4 py-2">
            <input type="checkbox" :checked="allChecked" class="rounded border-rule bg-bg-2" @change="toggleAll" />
          </th>
          <SortableTh label="Artist" sort-key="artist" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <SortableTh label="Release" sort-key="title" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <SortableTh label="Type" sort-key="releaseType" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <SortableTh label="Source" sort-key="source" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <SortableTh label="Status" sort-key="status" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <SortableTh label="Updated" sort-key="updatedAt" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
          <th class="px-4 py-2 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in sortedItems"
          :key="it.id"
          :ref="el => setRowEl(it.id, el)"
          class="border-b border-rule/50 transition-colors last:border-0"
          :class="highlightId === it.id ? 'bg-accent/10 ring-2 ring-inset ring-accent/60' : selected.has(it.id) ? 'bg-blue-950/20' : ''"
        >
          <td v-if="selectable" class="px-4 py-2">
            <input
              type="checkbox"
              :checked="selected.has(it.id)"
              class="rounded border-rule bg-bg-2"
              @change="toggleRow(it.id)"
            />
          </td>
          <td class="px-4 py-2.5 text-ink">
            <NuxtLink v-if="it.artistSlug" :to="`/artist/${it.artistSlug}`" class="hover:underline">
              {{ it.artist || '—' }}
            </NuxtLink>
            <span v-else>{{ it.artist || '—' }}</span>
          </td>
          <td class="px-4 py-2.5 text-ink-2">
            {{ it.title }}<span v-if="it.year" class="text-ink-3"> ({{ it.year }})</span>
          </td>
          <td class="px-4 py-2.5 text-ink-3">
            {{ it.releaseType || '—' }}
          </td>
          <td class="px-4 py-2.5 text-ink-3">
            <span class="inline-flex items-center gap-1.5">
              {{ sourceLabel(it.source) }}
            </span>
            <template v-if="it.quality"> · {{ it.quality }}</template>
            <template v-if="it.slskUsername"> · {{ it.slskUsername }}</template>
          </td>
          <td class="px-4 py-2.5">
            <Popover v-if="it.error" trigger="hover">
              <template #trigger>
                <span class="inline-flex cursor-help items-center gap-1.5" :class="statusClass(it.status)">
                  <AlertCircle v-if="it.status === 'FAILED'" :size="13" />
                  <Ban v-else-if="it.status === 'ABANDONED'" :size="13" />
                  <SearchX v-else-if="it.status === 'UNAVAILABLE'" :size="13" />
                  <FileX v-else-if="it.status === 'INVALID'" :size="13" />
                  {{ statusLabel(it) }}
                </span>
              </template>
              <template #content>
                <div class="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
                  <p class="text-xs text-ink-2">{{ it.error }}</p>
                </div>
              </template>
            </Popover>
            <span v-else class="inline-flex items-center gap-1.5" :class="statusClass(it.status)">
              <Loader2 v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" :size="13" class="animate-spin" />
              <AlertCircle v-else-if="it.status === 'FAILED'" :size="13" />
              <Ban v-else-if="it.status === 'ABANDONED'" :size="13" />
              <SearchX v-else-if="it.status === 'UNAVAILABLE'" :size="13" />
              <FileX v-else-if="it.status === 'INVALID'" :size="13" />
              {{ statusLabel(it) }}
            </span>
            <div v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" class="mt-1.5 flex items-center gap-2">
              <DownloadsDownloadProgress :percent="it.percent" :status="it.status" class="w-32" />
              <span class="text-xs text-ink-3">{{ it.percent }}%</span>
            </div>
          </td>
          <td class="px-4 py-2.5 whitespace-nowrap text-ink-3">
            {{ formatDate(it.updatedAt) }}
          </td>
          <td class="px-4 py-2.5">
            <div class="flex items-center justify-end gap-1">
              <button
                type="button"
                class="rounded-full p-1.5 text-ink-4 transition-colors hover:text-ink-2"
                title="Info"
                aria-label="Info"
                @click="emit('info', it.id)"
              >
                <Info :size="14" />
              </button>
              <button
                v-if="showActions && showRetry"
                type="button"
                class="rounded-full p-1.5 text-ink0 transition-colors hover:text-accent disabled:opacity-40 disabled:pointer-events-none"
                title="Force retry"
                aria-label="Force retry"
                :disabled="busyId != null && busyId !== it.id"
                @click="emit('retry', it.id)"
              >
                <Loader2 v-if="busyId === it.id" :size="14" class="animate-spin" />
                <RotateCw v-else :size="14" />
              </button>
              <button
                v-if="showMerge"
                type="button"
                class="rounded-full p-1.5 text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-40 disabled:pointer-events-none"
                title="Merge into library"
                aria-label="Merge"
                :disabled="busyIds.has(it.id)"
                @click="emit('merge', it.id)"
              >
                <Loader2 v-if="busyIds.has(it.id)" :size="14" class="animate-spin" />
                <FolderInput v-else :size="14" />
              </button>
              <button
                v-if="showCancel && (it.status === 'DOWNLOADING' || it.status === 'ENRICHING')"
                type="button"
                class="rounded-full p-1.5 text-red-400 transition-colors hover:text-red-300 disabled:opacity-40 disabled:pointer-events-none"
                title="Cancel download"
                aria-label="Cancel download"
                :disabled="busyId != null && busyId !== it.id"
                @click="emit('cancel', it.id)"
              >
                <Loader2 v-if="busyId === it.id" :size="14" class="animate-spin" />
                <X v-else :size="14" />
              </button>
              <button
                v-if="showRequeue"
                type="button"
                class="rounded-full p-1.5 text-ink0 transition-colors hover:text-accent disabled:opacity-40 disabled:pointer-events-none"
                title="Move back to queue"
                aria-label="Move back to queue"
                :disabled="busyId != null && busyId !== it.id"
                @click="emit('requeue', it.id)"
              >
                <Loader2 v-if="busyId === it.id" :size="14" class="animate-spin" />
                <Undo2 v-else :size="14" />
              </button>
              <button
                v-if="showActions"
                type="button"
                class="rounded-full p-1.5 text-red-400 transition-colors hover:text-red-300 disabled:opacity-40 disabled:pointer-events-none"
                title="Reject"
                aria-label="Reject"
                :disabled="busyId != null || it.status === 'DOWNLOADING'"
                @click="emit('reject', it.id)"
              >
                <X :size="14" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </Table>
</template>
