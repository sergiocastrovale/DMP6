<script setup lang="ts">
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function handleProgressClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  player.seek(pct * player.duration)
}

function handleVolumeChange(e: Event) {
  const value = parseFloat((e.target as HTMLInputElement).value)
  player.setVolume(value)
}
</script>

<template>
  <div
    v-if="player.isVisible"
    class="fixed bottom-0 left-0 z-50 flex h-20 w-full items-center border-t border-zinc-800 bg-zinc-950 px-4 lg:bottom-0"
  >
    <!-- Track info (left) -->
    <div class="flex w-1/4 min-w-0 items-center gap-3">
      <div
        class="size-12 shrink-0 rounded bg-zinc-800 bg-cover bg-center"
        :style="player.currentTrack?.releaseImage ? { backgroundImage: `url(${player.currentTrack.releaseImage})` } : {}"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-zinc-50">
          {{ player.currentTrack?.title || 'No track' }}
        </p>
        <p class="truncate text-xs text-zinc-400">
          {{ player.currentTrack?.artist || '' }}
        </p>
      </div>
    </div>

    <!-- Controls + progress (center) -->
    <div class="flex flex-1 flex-col items-center gap-1">
      <div class="flex items-center gap-4">
        <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.previous()">
          <SkipBack :size="18" />
        </button>
        <button
          class="flex size-8 items-center justify-center rounded-full bg-zinc-50 text-zinc-950 hover:scale-105 transition-transform"
          @click="player.togglePlay()"
        >
          <Pause v-if="player.isPlaying" :size="16" />
          <Play v-else :size="16" class="ml-0.5" />
        </button>
        <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.next()">
          <SkipForward :size="18" />
        </button>
      </div>
      <div class="flex w-full max-w-lg items-center gap-2 text-xs text-zinc-400">
        <span class="w-10 text-right tabular-nums">{{ formatTime(player.currentTime) }}</span>
        <div
          class="group relative h-1 flex-1 cursor-pointer rounded-full bg-zinc-700"
          @click="handleProgressClick"
        >
          <div
            class="h-full rounded-full bg-zinc-50 group-hover:bg-amber-500 transition-colors"
            :style="{ width: `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%` }"
          />
        </div>
        <span class="w-10 tabular-nums">{{ formatTime(player.duration) }}</span>
      </div>
    </div>

    <!-- Volume (right) -->
    <div class="flex w-1/4 items-center justify-end gap-2">
      <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.toggleMute()">
        <VolumeX v-if="player.isMuted || player.volume === 0" :size="18" />
        <Volume2 v-else :size="18" />
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.isMuted ? 0 : player.volume"
        class="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-50"
        @input="handleVolumeChange"
      />
    </div>
  </div>
</template>
