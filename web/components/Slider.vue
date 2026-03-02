<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  leftLabel: string
  rightLabel: string
  title: string
  stops: string[]
}>(), {
  min: 0,
  max: 9,
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const currentLabel = computed(() => props.stops[props.modelValue] ?? '')

function onInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  emit('update:modelValue', val)
}
</script>

<template>
  <div class="rounded-xl bg-zinc-900/50 px-5 py-4">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-sm font-medium text-zinc-400">{{ title }}</span>
      <span class="rounded-md bg-zinc-800 px-2.5 py-0.5 text-sm font-semibold text-zinc-50">
        {{ currentLabel }}
      </span>
    </div>

    <div class="flex items-center gap-3">
      <span class="w-20 shrink-0 text-right text-xs text-zinc-500">{{ leftLabel }}</span>

      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        class="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500
               [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
               [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
               [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:shadow-md
               [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125
               [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
               [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0
               [&::-moz-range-thumb]:bg-amber-500 [&::-moz-range-thumb]:shadow-md"
        @input="onInput"
      >

      <span class="w-20 shrink-0 text-xs text-zinc-500">{{ rightLabel }}</span>
    </div>
  </div>
</template>
