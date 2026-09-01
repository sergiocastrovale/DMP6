<script setup lang="ts">
import type { Tone, LoadingPanelSize } from '~/types/ui'
import { toneFill } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  label?: string
  percent: number
  variant?: Tone
  size?: LoadingPanelSize
}>(), {
  variant: 'accent',
  size: 'md',
})

const barHeight = computed(() => (props.size === 'sm' ? 'h-1' : 'h-1.5'))
const clampedPercent = computed(() => Math.round(Math.max(0, Math.min(100, props.percent))))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div v-if="label" class="flex items-center justify-between text-xs">
      <span class="text-stone-100/60">{{ label }}</span>
      <span class="text-stone-100/55 tabular-nums">{{ clampedPercent }}%</span>
    </div>
    <div
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="clampedPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      class="w-full overflow-hidden rounded-full bg-stone-800"
      :class="barHeight"
    >
      <div
        class="rounded-full transition-[width] duration-300"
        :class="[barHeight, toneFill[variant]]"
        :style="{ width: `${clampedPercent}%` }"
      />
    </div>
  </div>
</template>
