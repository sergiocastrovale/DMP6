<script setup lang="ts">
import { formatDuration } from '~/helpers/functions'
import { cx } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  currentTime: number
  duration: number
  // Right-hand label counts down ("-2:56") instead of showing the total duration - used by
  // Explore's now-playing card; the persistent player bar shows the total instead.
  countDown?: boolean
  // Shows a hover popover with "{current} / {total}" over the track - the persistent player
  // bar wants this, Explore's now-playing card already has always-visible labels and doesn't.
  hoverPopover?: boolean
  // TV/cinema-mode Explore only: thicker rail and bigger time labels for couch legibility. Also
  // used by the mobile expanded sheet, which is why this branch (not hoverPopover) gets drag.
  large?: boolean
  // Persistent player bar's top-pinned variant: hides the time labels, renders a hairline rail
  // spanning the full width, with a thumb dot that only appears on hover.
  slim?: boolean
  // Which side of the rail the hover popover opens on - 'bottom' for the top-pinned slim bar,
  // where 'top' would render off the top edge of the viewport.
  popoverPlacement?: 'top' | 'bottom'
}>(), {
  countDown: false,
  hoverPopover: false,
  large: false,
  slim: false,
  popoverPlacement: 'top',
})

const emit = defineEmits<{
  seek: [time: number]
}>()

const trackRef = ref<HTMLElement>()
// While a drag is in progress, the rail follows the pointer instead of the (not-yet-updated)
// currentTime prop; only pointerup actually emits. Emitting on every pointermove would call
// audio.currentTime dozens of times per gesture (unlike VolumeControl's continuous drag, where
// audio.volume is free to set repeatedly, a real seek is not).
const dragTime = ref<number | null>(null)

const displayTime = computed(() => dragTime.value ?? props.currentTime)
const progressPct = computed(() => (props.duration ? (displayTime.value / props.duration) * 100 : 0))

const rightLabel = computed(() => props.countDown
  ? `-${formatDuration(Math.max(0, props.duration - displayTime.value))}`
  : formatDuration(props.duration))

const hoverLabel = computed(() => `${formatDuration(props.currentTime)} / ${formatDuration(props.duration)}`)

const handleClick = (event: MouseEvent) => {
  const bar = event.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = rect.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  emit('seek', pct * props.duration)
}

const timeFromClientX = (clientX: number) => {
  const el = trackRef.value
  if (!el) {
    return 0
  }
  const rect = el.getBoundingClientRect()
  const pct = rect.width === 0 ? 0 : Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return pct * props.duration
}

const onPointerDown = (event: PointerEvent) => {
  dragTime.value = timeFromClientX(event.clientX)
  try {
    trackRef.value?.setPointerCapture(event.pointerId)
  }
  catch { /* not implemented in this environment - click-to-position still works */ }
}

const onPointerMove = (event: PointerEvent) => {
  if (dragTime.value === null || event.buttons === 0) {
    return
  }
  dragTime.value = timeFromClientX(event.clientX)
}

const onPointerUp = () => {
  if (dragTime.value === null) {
    return
  }
  emit('seek', dragTime.value)
  dragTime.value = null
}
</script>

<template>
  <div :class="cx('flex w-full items-center gap-2')">
    <span v-if="!slim" :class="cx('shrink-0 text-left text-stone-100/55 tabular-nums', large ? 'w-10 text-base' : 'w-8 text-2xs')">{{ formatDuration(displayTime) }}</span>

    <Popover v-if="hoverPopover" trigger="hover" class="flex-1">
      <template #trigger>
        <div
          role="slider"
          tabindex="0"
          :class="cx(
            'relative w-full cursor-pointer bg-stone-800',
            slim ? 'rounded-r-full' : 'rounded-full',
            large ? 'h-2.75' : 'h-1.25',
          )"
          :aria-valuenow="Math.round(currentTime)"
          aria-valuemin="0"
          :aria-valuemax="Math.round(duration)"
          @click="handleClick"
          @keydown.left="emit('seek', Math.max(0, currentTime - 5))"
          @keydown.right="emit('seek', Math.min(duration, currentTime + 5))"
        >
          <div class="h-full bg-gradient-to-b from-amber-600 to-amber-400" :class="slim ? 'rounded-r-full' : 'rounded-full'" :style="{ width: `${progressPct}%` }" />
        </div>
      </template>
      <template #content>
        <div
          :class="cx(
            'absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-stone-100/10 bg-stone-900 px-2 py-1 text-2xs tabular-nums text-stone-100 shadow-lg',
            popoverPlacement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          )"
        >
          {{ hoverLabel }}
        </div>
      </template>
    </Popover>
    <div
      v-else
      ref="trackRef"
      role="slider"
      tabindex="0"
      :class="cx(
        'relative flex-1 cursor-pointer touch-none bg-stone-800',
        slim ? 'rounded-r-full' : 'rounded-full',
        large ? 'h-3' : 'h-1.25',
      )"
      :aria-valuenow="Math.round(currentTime)"
      aria-valuemin="0"
      :aria-valuemax="Math.round(duration)"
      @click="handleClick"
      @keydown.left="emit('seek', Math.max(0, currentTime - 5))"
      @keydown.right="emit('seek', Math.min(duration, currentTime + 5))"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="h-full bg-gradient-to-b from-amber-600 to-amber-400" :class="slim ? 'rounded-r-full' : 'rounded-full'" :style="{ width: `${progressPct}%` }" />
    </div>

    <span v-if="!slim" :class="cx('shrink-0 text-right text-stone-100/55 tabular-nums', large ? 'w-12 text-base' : 'w-10 text-2xs')">{{ rightLabel }}</span>
  </div>
</template>
