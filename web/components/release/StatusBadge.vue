<script setup lang="ts">
import type { ReleaseStatus } from '~/types/release'

const props = defineProps<{
  status: ReleaseStatus
  trackCount?: number
  localTrackCount?: number
}>()

const config: Record<ReleaseStatus, { label: string; classes: string }> = {
  COMPLETE: { label: 'Complete', classes: 'bg-emerald-500/20 text-emerald-400' },
  INCOMPLETE: { label: 'Incomplete', classes: 'bg-accent/20 text-accent' },
  EXTRA_TRACKS: { label: 'Extra tracks', classes: 'bg-blue-500/20 text-blue-400' },
  MISSING_TRACKS: { label: 'Missing tracks', classes: 'bg-orange-500/20 text-orange-400' },
  MISSING: { label: 'Missing', classes: 'bg-red-500/20 text-red-400' },
  UNKNOWN: { label: 'Unknown', classes: 'bg-bg-3 text-ink-2' },
  UNMATCHED: { label: 'Unmatched', classes: 'bg-accent-soft text-accent' },
}

const cfg = computed(() => config[props.status] || config.UNKNOWN)

const label = computed(() => cfg.value.label)
</script>

<template>
  <span :class="cfg.classes" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
    {{ label }}
  </span>
</template>
