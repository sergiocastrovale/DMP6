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
  // TV/cinema-mode Explore only: thicker rail and bigger time labels for couch legibility.
  large?: boolean
}>(), {
  countDown: false,
  hoverPopover: false,
  large: false,
})

const emit = defineEmits<{
  seek: [time: number]
}>()

const progressPct = computed(() => (props.duration ? (props.currentTime / props.duration) * 100 : 0))

const rightLabel = computed(() => props.countDown
  ? `-${formatDuration(Math.max(0, props.duration - props.currentTime))}`
  : formatDuration(props.duration))

const hoverLabel = computed(() => `${formatDuration(props.currentTime)} / ${formatDuration(props.duration)}`)

const handleClick = (event: MouseEvent) => {
  const bar = event.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = rect.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  emit('seek', pct * props.duration)
}
</script>

<template>
  <div :class="cx('flex w-full items-center gap-2')">
    <span :class="cx('shrink-0 text-left text-stone-100/55 tabular-nums', large ? 'w-10 text-base' : 'w-8 text-2xs')">{{ formatDuration(currentTime) }}</span>

    <Popover v-if="hoverPopover" trigger="hover" class="flex-1">
      <template #trigger>
        <div
          role="slider"
          tabindex="0"
          :class="cx('group relative w-full cursor-pointer rounded-full bg-stone-800', large ? 'h-3' : 'h-1.5')"
          :aria-valuenow="Math.round(currentTime)"
          aria-valuemin="0"
          :aria-valuemax="Math.round(duration)"
          @click="handleClick"
          @keydown.left="emit('seek', Math.max(0, currentTime - 5))"
          @keydown.right="emit('seek', Math.min(duration, currentTime + 5))"
        >
          <div class="h-full rounded-full bg-amber-400" :style="{ width: `${progressPct}%` }" />
        </div>
      </template>
      <template #content>
        <div class="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-stone-100/10 bg-stone-900 px-2 py-1 text-2xs tabular-nums text-stone-100 shadow-lg">
          {{ hoverLabel }}
        </div>
      </template>
    </Popover>
    <div
      v-else
      role="slider"
      tabindex="0"
      :class="cx('group relative flex-1 cursor-pointer rounded-full bg-stone-800', large ? 'h-3' : 'h-1.5')"
      :aria-valuenow="Math.round(currentTime)"
      aria-valuemin="0"
      :aria-valuemax="Math.round(duration)"
      @click="handleClick"
      @keydown.left="emit('seek', Math.max(0, currentTime - 5))"
      @keydown.right="emit('seek', Math.min(duration, currentTime + 5))"
    >
      <div class="h-full rounded-full bg-amber-400" :style="{ width: `${progressPct}%` }" />
    </div>

    <span :class="cx('shrink-0 text-right text-stone-100/55 tabular-nums', large ? 'w-12 text-base' : 'w-10 text-2xs')">{{ rightLabel }}</span>
  </div>
</template>
