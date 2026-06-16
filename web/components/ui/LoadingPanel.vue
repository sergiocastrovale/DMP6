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

const variants: Record<Variant, string> = {
  accent: 'bg-accent',
  success: 'bg-emerald-400',
  violet: 'bg-violet-400',
  danger: 'bg-red-400',
  neutral: 'bg-ink-3',
}

const barHeight = computed(() => (props.size === 'sm' ? 'h-1' : 'h-1.5'))
const clampedPercent = computed(() => Math.max(0, Math.min(100, props.percent)))
</script>

<template>
  <div class="space-y-1.5">
    <div v-if="label" class="flex items-center justify-between text-xs">
      <span class="text-ink-2">{{ label }}</span>
      <span class="text-ink0">{{ clampedPercent }}%</span>
    </div>
    <div class="w-full overflow-hidden rounded-full bg-bg-2" :class="barHeight">
      <div
        class="rounded-full transition-all duration-300"
        :class="[barHeight, variants[variant]]"
        :style="{ width: `${clampedPercent}%` }"
      />
    </div>
  </div>
</template>
