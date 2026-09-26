<script setup lang="ts">
import type { DecadeStats } from '~/types/labs'

const props = defineProps<{
  decades: DecadeStats[] | null | undefined
  selected: string[]
  series: { decade: DecadeStats, dot: string }[]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)

useDecadeRadar(canvas, toRef(props, 'decades'), toRef(props, 'selected'))
</script>

<template>
  <div class="sticky top-20 flex h-[600px] flex-col rounded-xl border border-stone-100/10 bg-stone-900 p-6">
    <UiEmptyState v-if="selected.length === 0" class="m-auto" message="Select decades to compare" />
    <canvas v-show="selected.length > 0" ref="canvas" class="min-h-0 w-full flex-1" />
    <div v-if="series.length > 0" class="mt-4 flex flex-wrap items-center justify-center gap-4">
      <span v-for="{ decade: d, dot } in series" :key="d.decade" class="flex items-center gap-1.5 text-sm text-stone-100/60">
        <span class="size-2 rounded-full" :class="dot" />
        {{ d.decade }}
      </span>
    </div>
  </div>
</template>
