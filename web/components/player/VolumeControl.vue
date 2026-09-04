<script setup lang="ts">
import { Volume2, VolumeX } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx } from '~/helpers/ui'

// Fixed w-20 fits the desktop bar's right-hand cluster; the mobile sheet gives volume its own
// full-width row, where fluid stretches the track to fill it. A class on the component tag can't
// reach the inner track (attrs fall through to the outer wrapper), hence a real prop.
withDefaults(defineProps<{ fluid?: boolean }>(), { fluid: false })

const player = usePlayerStore()

const percent = computed(() => (player.isMuted ? 0 : player.volume) * 100)

const trackRef = ref<HTMLElement>()

const setFromClientX = (clientX: number) => {
  const track = trackRef.value
  if (!track) {
    return
  }
  const rect = track.getBoundingClientRect()
  const ratio = rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  player.setVolume(Math.round(ratio * 100) / 100)
}

const onPointerDown = (event: PointerEvent) => {
  setFromClientX(event.clientX)
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
    player.setVolume(Math.min(1, Math.max(0, Math.round((player.volume + delta) * 100) / 100)))
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    step(-0.05)
  }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    step(0.05)
  }
  else if (event.key === 'Home') {
    event.preventDefault()
    player.setVolume(0)
  }
  else if (event.key === 'End') {
    event.preventDefault()
    player.setVolume(1)
  }
}
</script>

<template>
  <div :class="cx('flex items-center', fluid && 'w-full gap-2')">
    <UiButton
      variant="ghost"
      size="lg"
      icon-only
      :icon="player.isMuted || player.volume === 0 ? VolumeX : Volume2"
      :aria-label="player.isMuted ? 'Unmute' : 'Mute'"
      @click="player.toggleMute()"
    />
    <div
      ref="trackRef"
      role="slider"
      tabindex="0"
      :class="cx('relative h-1.5 cursor-pointer touch-none rounded-full bg-stone-800', fluid ? 'flex-1' : 'w-20')"
      aria-label="Volume"
      :aria-valuenow="Math.round(percent)"
      aria-valuemin="0"
      aria-valuemax="100"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @keydown="onKeydown"
    >
      <div class="h-full rounded-full bg-amber-400" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>
