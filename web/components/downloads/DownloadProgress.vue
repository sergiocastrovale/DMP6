<script setup lang="ts">
import type { ReleaseProgress } from '~/types/download'
import { formatFileSize } from '~/helpers/functions'
import { downloadStatusTone } from '~/helpers/constants'
import type { Tone } from '~/types/ui'

const props = defineProps<{
  items?: ReleaseProgress[] // items-aggregate mode: a batch of in-flight releases, percent from bytes
  percent?: number // single mode: one release's percent; also the percent for label mode
  status?: string // single mode: one release's status
  label?: string // label mode: a precomputed aggregate (e.g. merge) - label + percent given directly
}>()

const statusVariant = (status?: string): Tone => downloadStatusTone[status ?? 'DOWNLOADING'] ?? 'accent'

const aggregate = computed(() => props.items != null)
const labelled = computed(() => props.items == null && props.label != null)

const total = computed(() => props.items?.length ?? 0)
const overallBytes = computed(() => {
  const items = props.items ?? []
  const totalBytes = items.reduce((s, i) => s + (i.totalBytes ?? 0), 0)
  const moved = items.reduce((s, i) => s + (i.bytesTransferred ?? 0), 0)
  return { totalBytes, moved }
})
const overallPercent = computed(() => {
  const items = props.items ?? []
  if (items.length === 0) { return 0 }
  const { totalBytes, moved } = overallBytes.value
  if (totalBytes > 0) {
    return Math.min(100, Math.round((moved / totalBytes) * 100))
  }
  return Math.round(items.reduce((s, i) => s + i.percent, 0) / items.length)
})

const aggregateLabel = computed(() => {
  const n = total.value
  const base = `Downloading ${n} release${n !== 1 ? 's' : ''}`
  const { totalBytes, moved } = overallBytes.value
  return totalBytes > 0 ? `${base} — ${formatFileSize(moved)} / ${formatFileSize(totalBytes)}` : `${base}…`
})

const single = computed(() => ({
  percent: Math.max(0, Math.min(100, props.percent ?? 0)),
  variant: statusVariant(props.status),
}))
</script>

<template>
  <UiLoadingPanel v-if="labelled" :label="label" :percent="percent ?? 0" variant="accent" size="md" />

  <UiLoadingPanel
    v-else-if="aggregate && total > 0"
    :label="aggregateLabel"
    :percent="overallPercent"
    variant="accent"
    size="md"
  />

  <UiLoadingPanel v-else-if="!aggregate" :percent="single.percent" :variant="single.variant" size="sm" />
</template>
