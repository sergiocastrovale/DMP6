<script setup lang="ts">
type Variant = 'accent' | 'success' | 'violet' | 'danger' | 'neutral'
type Size = 'sm' | 'md'

const props = withDefaults(defineProps<{
  label?: string
  percent: number
  variant?: Variant
  size?: Size
}>(), {
  variant: 'accent',
  size: 'md',
})

const VARIANT_FILL: Record<Variant, string> = {
  accent: 'bg-amber-400',
  success: 'bg-success',
  violet: 'bg-info',
  danger: 'bg-danger',
  neutral: 'bg-stone-100/30',
}

const barHeight = computed(() => (props.size === 'sm' ? 'h-1' : 'h-1.5'))
const clampedPercent = computed(() => Math.max(0, Math.min(100, props.percent)))
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
        :class="[barHeight, VARIANT_FILL[variant]]"
        :style="{ width: `${clampedPercent}%` }"
      />
    </div>
  </div>
</template>
