<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { ReleaseProgress } from '~/types/download'

const props = defineProps<{
  items?: ReleaseProgress[] // aggregate mode: a batch of in-flight releases
  percent?: number // single mode: one release's percent
  status?: string // single mode: one release's status
}>()

const barColor = (status?: string) => ({
  DOWNLOADING: 'bg-accent',
  ENRICHING: 'bg-violet-400',
  PENDING: 'bg-emerald-400',
  APPROVED: 'bg-emerald-400',
  PROMOTED: 'bg-emerald-400',
  FAILED: 'bg-red-400',
  ABANDONED: 'bg-red-400',
  REJECTED: 'bg-ink-3',
}[status ?? 'DOWNLOADING'] || 'bg-accent')

const aggregate = computed(() => props.items != null)

const total = computed(() => props.items?.length ?? 0)
const done = computed(() =>
  (props.items ?? []).filter(i => i.percent >= 100 || i.status === 'ENRICHING').length,
)
const overallPercent = computed(() => {
  const items = props.items ?? []
  if (items.length === 0) return 0
  const totalBytes = items.reduce((s, i) => s + (i.totalBytes ?? 0), 0)
  if (totalBytes > 0) {
    const moved = items.reduce((s, i) => s + (i.bytesTransferred ?? 0), 0)
    return Math.min(100, Math.round((moved / totalBytes) * 100))
  }
  return Math.round(items.reduce((s, i) => s + i.percent, 0) / items.length)
})

const single = computed(() => ({
  percent: Math.max(0, Math.min(100, props.percent ?? 0)),
  color: barColor(props.status),
}))
</script>

<template>
  <div v-if="!aggregate" class="h-1 w-full overflow-hidden rounded-full bg-bg-2">
    <div
      class="h-full rounded-full transition-all duration-300"
      :class="single.color"
      :style="{ width: `${single.percent}%` }"
    />
  </div>

  <div v-else-if="total > 0" class="space-y-1.5">
    <div class="flex items-center justify-between text-xs">
      <span class="flex items-center gap-1.5 text-ink-2">
        <Loader2 :size="13" class="animate-spin" />
        Downloading {{ done }} of {{ total }} release{{ total === 1 ? '' : 's' }}…
      </span>
      <span class="text-ink0">{{ overallPercent }}%</span>
    </div>
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-bg-2">
      <div
        class="h-1.5 rounded-full bg-accent transition-all duration-300"
        :style="{ width: `${overallPercent}%` }"
      />
    </div>
  </div>
</template>
