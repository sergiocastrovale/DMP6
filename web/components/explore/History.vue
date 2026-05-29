<script setup lang="ts">
import { Clock, Play } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { formatDuration } from '~/helpers/functions'

defineProps<{
  tracks: PlayerTrack[]
}>()

const emit = defineEmits<{
  play: [track: PlayerTrack]
}>()

</script>

<template>
  <div>
    <div class="mb-3 flex items-center gap-2 text-sm font-medium text-ink-2">
      <Clock :size="14" />
      Session History
    </div>

    <div class="flex flex-col divide-y divide-rule/50 rounded-xl border border-rule bg-bg-1/50">
      <button
        v-for="track in tracks"
        :key="track.id"
        class="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-2/50"
        @click="emit('play', track)"
      >
        <Play :size="14" class="shrink-0 text-ink0" />
        <span class="min-w-0 flex-1 truncate text-sm text-ink-2">
          {{ track.title }}
          <span class="text-ink0"> - {{ track.artist }}</span>
        </span>
        <span v-if="track.duration" class="shrink-0 text-xs tabular-nums text-ink-4">
          {{ formatDuration(track.duration) }}
        </span>
      </button>
    </div>
  </div>
</template>
