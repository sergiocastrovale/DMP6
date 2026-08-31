<script setup lang="ts">
// The app's one range control. Two shapes come out of the same component:
//   - Explore's mood dials pass `stops` + end labels, so the pill reads "MELANCHOLIC" and the rail
//     is bracketed by "Tired"/"Powerful".
//   - Labs' thresholds pass neither, so the pill shows the raw number and the rail spans the row.
// Anything that wants a drag track uses this; nothing hand-rolls one (handoff/RULES.md).
const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  leftLabel?: string
  rightLabel?: string
  title: string
  stops?: string[]
  hint?: string
}>(), {
  min: 0,
  max: 9,
  step: 1,
  leftLabel: undefined,
  rightLabel: undefined,
  stops: undefined,
  hint: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const trackRef = ref<HTMLElement>()
const currentLabel = computed(() => props.stops?.[props.modelValue] ?? String(props.modelValue))
const percent = computed(() => ((props.modelValue - props.min) / (props.max - props.min)) * 100)

const clamp = (value: number) => Math.min(props.max, Math.max(props.min, Math.round(value / props.step) * props.step))

const setFromClientX = (clientX: number) => {
  const track = trackRef.value
  if (!track) {
    return
  }
  const rect = track.getBoundingClientRect()
  const ratio = rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  emit('update:modelValue', clamp(props.min + ratio * (props.max - props.min)))
}

const onPointerDown = (event: PointerEvent) => {
  setFromClientX(event.clientX)
  // Pointer capture keeps drag updates coming even once the cursor leaves the track - without
  // it a fast drag past the rail's edge would stop tracking mid-gesture. Not every test DOM
  // implements it, so this degrades to click-to-position there rather than throwing.
  try {
    trackRef.value?.setPointerCapture(event.pointerId)
  }
  catch { /* not implemented in this environment - click-to-position still works */ }
}

const onPointerMove = (event: PointerEvent) => {
  if (event.buttons === 0) {
    return
  }
  setFromClientX(event.clientX)
}

const onKeydown = (event: KeyboardEvent) => {
  const step = (delta: number) => {
    event.preventDefault()
    emit('update:modelValue', clamp(props.modelValue + delta))
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    step(-props.step)
  }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    step(props.step)
  }
  else if (event.key === 'Home') {
    event.preventDefault()
    emit('update:modelValue', props.min)
  }
  else if (event.key === 'End') {
    event.preventDefault()
    emit('update:modelValue', props.max)
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <span class="text-base font-medium text-stone-100">{{ title }}</span>
      <span class="rounded-full bg-amber-400 px-2.5 py-0.5 font-mono text-2xs font-bold uppercase tracking-wider text-on-accent">
        {{ currentLabel }}
      </span>
    </div>

    <div class="flex items-center gap-3">
      <span v-if="leftLabel" class="w-24 shrink-0 text-xs text-stone-100/55">{{ leftLabel }}</span>

      <div
        ref="trackRef"
        role="slider"
        tabindex="0"
        class="relative h-4 flex-1 flex items-center cursor-pointer touch-none"
        :aria-label="title"
        :aria-valuenow="modelValue"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuetext="currentLabel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @keydown="onKeydown"
      >
        <div class="absolute inset-x-0 h-1 rounded-full bg-stone-700" />
        <div
          class="absolute left-0 h-1 rounded-full bg-amber-400 shadow-[0_0_10px_color-mix(in_oklch,var(--color-amber-400)_45%,transparent)]"
          :style="{ width: `${percent}%` }"
        />
        <div class="absolute size-3.5 -ml-[7px] rounded-full bg-stone-100 shadow-md" :style="{ left: `${percent}%` }" />
      </div>

      <span v-if="rightLabel" class="w-24 shrink-0 text-right text-xs text-stone-100/55">{{ rightLabel }}</span>
    </div>

    <p v-if="hint" class="mt-2 text-xs leading-snug text-stone-100/55">{{ hint }}</p>
  </div>
</template>
