<script setup lang="ts">
import { Check, X, Loader2, AlertCircle, Ban } from 'lucide-vue-next'
import type { DownloadedReleaseItem } from '~/types/download'

const props = defineProps<{
  items: DownloadedReleaseItem[]
  busyId?: string | null
  showActions?: boolean
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
}>()

const statusClass = (s: string) => ({
  DOWNLOADING: 'text-blue-400',
  ENRICHING: 'text-violet-400',
  PENDING: 'text-amber-400',
  PROMOTED: 'text-emerald-400',
  REJECTED: 'text-ink-3',
  FAILED: 'text-red-400',
  ABANDONED: 'text-ink-3',
  APPROVED: 'text-emerald-400',
}[s] || 'text-ink-2')

const statusLabel = (it: DownloadedReleaseItem) =>
  it.status === 'ABANDONED' ? `gave up${it.attempts ? ` (${it.attempts} tries)` : ''}` : it.status.toLowerCase()
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
          <th v-if="showActions" class="px-4 py-2 font-medium text-right">Actions</th>
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
            <span class="inline-flex items-center gap-1.5" :class="statusClass(it.status)">
              <Loader2 v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" :size="13" class="animate-spin" />
              <AlertCircle v-else-if="it.status === 'FAILED'" :size="13" />
              <Ban v-else-if="it.status === 'ABANDONED'" :size="13" />
              {{ statusLabel(it) }}
            </span>
            <span v-if="it.error" class="ml-1 text-xs text-red-400/80" :title="it.error">!</span>
            <div v-if="it.status === 'DOWNLOADING' || it.status === 'ENRICHING'" class="mt-1.5 flex items-center gap-2">
              <DownloadsDownloadProgress :percent="it.percent" :status="it.status" class="w-32" />
              <span class="text-xs text-ink-3">{{ it.percent }}%</span>
            </div>
          </td>
          <td v-if="showActions" class="px-4 py-2.5">
            <div class="flex items-center justify-end gap-2">
              <UiButton
                size="sm"
                variant="primary"
                :icon="Check"
                :loading="busyId === it.id"
                :disabled="it.status !== 'PENDING' || (busyId != null && busyId !== it.id)"
                @click="emit('approve', it.id)"
              >
                Approve
              </UiButton>
              <UiButton
                size="sm"
                variant="danger"
                :icon="X"
                :disabled="busyId != null || it.status === 'DOWNLOADING'"
                @click="emit('reject', it.id)"
              >
                Reject
              </UiButton>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </Table>
</template>
