<script setup lang="ts">
import type { ReleaseStatus } from '~/types/release'

const props = defineProps<{
  status: ReleaseStatus
  trackCount?: number
  localTrackCount?: number
}>()

const config: Record<ReleaseStatus, { label: string; classes: string }> = {
  COMPLETE: { label: 'Complete', classes: 'bg-emerald-500/20 text-emerald-400' },
  INCOMPLETE: { label: 'Incomplete', classes: 'bg-amber-500/20 text-amber-400' },
  EXTRA_TRACKS: { label: 'Extra tracks', classes: 'bg-blue-500/20 text-blue-400' },
  MISSING: { label: 'Missing', classes: 'bg-red-500/20 text-red-400' },
  UNSYNCABLE: { label: 'Unsyncable', classes: 'bg-zinc-700 text-zinc-400' },
  UNKNOWN: { label: 'Unknown', classes: 'bg-zinc-700 text-zinc-400' },
}

const cfg = computed(() => config[props.status] || config.UNKNOWN)

const label = computed(() => cfg.value.label)
</script>

<template>
  <span :class="cfg.classes" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
    {{ label }}
  </span>
</template>
