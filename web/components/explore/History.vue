<script setup lang="ts">
import { Clock, Play } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'

defineProps<{
  tracks: PlayerTrack[]
}>()

const emit = defineEmits<{
  play: [track: PlayerTrack]
}>()

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
      <Clock :size="14" />
      Session History
    </div>

    <div class="flex flex-col divide-y divide-zinc-800/50 rounded-xl border border-zinc-800 bg-zinc-900/50">
      <button
        v-for="track in tracks"
        :key="track.id"
        class="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/50"
        @click="emit('play', track)"
      >
        <Play :size="14" class="shrink-0 text-zinc-500" />
        <span class="min-w-0 flex-1 truncate text-sm text-zinc-300">
          {{ track.title }}
          <span class="text-zinc-500"> — {{ track.artist }}</span>
        </span>
        <span v-if="track.duration" class="shrink-0 text-xs tabular-nums text-zinc-600">
          {{ formatDuration(track.duration) }}
        </span>
      </button>
    </div>
  </div>
</template>
