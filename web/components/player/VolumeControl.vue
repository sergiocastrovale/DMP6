<script setup lang="ts">
import { Volume2, VolumeX } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

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
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="text-stone-100/60 transition-colors duration-150 hover:text-stone-100"
      :aria-label="player.isMuted ? 'Unmute' : 'Mute'"
      @click="player.toggleMute()"
    >
      <VolumeX v-if="player.isMuted || player.volume === 0" :size="18" :stroke-width="ICON_STROKE_WIDTH" />
      <Volume2 v-else :size="18" :stroke-width="ICON_STROKE_WIDTH" />
    </button>
    <div
      ref="trackRef"
      role="slider"
      tabindex="0"
      class="relative h-1.5 w-20 cursor-pointer touch-none rounded-full bg-stone-800"
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
