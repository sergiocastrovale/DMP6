<script setup lang="ts">
import type { ReleaseProgress } from '~/types/download'

const props = defineProps<{
  items?: ReleaseProgress[] // aggregate mode: a batch of in-flight releases
  percent?: number // single mode: one release's percent
  status?: string // single mode: one release's status
}>()

const statusVariant = (status?: string) => ({
  DOWNLOADING: 'accent',
  ENRICHING: 'violet',
  READY: 'success',
  PROMOTED: 'success',
  FAILED: 'danger',
  ABANDONED: 'danger',
  REJECTED: 'neutral',
}[status ?? 'DOWNLOADING'] || 'accent') as 'accent' | 'success' | 'violet' | 'danger' | 'neutral'

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
  variant: statusVariant(props.status),
}))
</script>

<template>
  <UiLoadingPanel v-if="!aggregate" :percent="single.percent" :variant="single.variant" size="sm" />

  <UiLoadingPanel
    v-else-if="total > 0"
    :label="`Downloading ${done} of ${total} release${total === 1 ? '' : 's'}…`"
    :percent="overallPercent"
    variant="accent"
    size="md"
  />
</template>
