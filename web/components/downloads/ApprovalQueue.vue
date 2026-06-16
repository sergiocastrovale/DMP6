<script setup lang="ts">
import { Check, X, Loader2, AlertCircle, Ban, RotateCw, Info, FolderInput, SearchX, FileX } from 'lucide-vue-next'
import type { DownloadedReleaseItem } from '~/types/download'

const props = defineProps<{
  items: DownloadedReleaseItem[]
  busyId?: string | null
  showActions?: boolean
  showApprove?: boolean
  showRetry?: boolean
  showMerge?: boolean
  showCancel?: boolean
  highlightId?: string | null
}>()

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
  approve: [id: string]
  reject: [id: string]
  retry: [id: string]
  merge: [id: string]
  cancel: [id: string]
  info: [id: string]
}>()

const statusClass = (s: string) => ({
  DOWNLOADING: 'text-blue-400',
  ENRICHING: 'text-violet-400',
  PENDING: 'text-amber-400',
  PROMOTED: 'text-emerald-400',
  REJECTED: 'text-ink-3',
  FAILED: 'text-red-400',
  ABANDONED: 'text-ink-3',
  UNAVAILABLE: 'text-ink-3',
  INVALID: 'text-ink-3',
  APPROVED: 'text-emerald-400',
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
          <th class="px-4 py-2 font-medium">Artist</th>
          <th class="px-4 py-2 font-medium">Release</th>
          <th class="px-4 py-2 font-medium">Source</th>
          <th class="px-4 py-2 font-medium">Status</th>
          <th class="px-4 py-2 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="it in items"
          :key="it.id"
          :ref="el => setRowEl(it.id, el)"
          class="border-b border-rule/50 transition-colors last:border-0"
          :class="highlightId === it.id ? 'bg-accent/10 ring-2 ring-inset ring-accent/60' : ''"
        >
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
            {{ it.source }}<template v-if="it.quality"> · {{ it.quality }}</template>
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
                :disabled="busyId != null && busyId !== it.id"
                @click="emit('merge', it.id)"
              >
                <Loader2 v-if="busyId === it.id" :size="14" class="animate-spin" />
                <FolderInput v-else :size="14" />
              </button>
              <button
                v-if="showApprove"
                type="button"
                class="rounded-full p-1.5 text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-40 disabled:pointer-events-none"
                title="Approve"
                aria-label="Approve"
                :disabled="it.status !== 'PENDING' || (busyId != null && busyId !== it.id)"
                @click="emit('approve', it.id)"
              >
                <Loader2 v-if="busyId === it.id" :size="14" class="animate-spin" />
                <Check v-else :size="14" />
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
