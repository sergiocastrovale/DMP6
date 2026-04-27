<script setup lang="ts">
import { Compass, RefreshCw } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { formatDuration } from '~/helpers/functions'

const props = defineProps<{
  track: PlayerTrack
  isLoading?: boolean
}>()

const emit = defineEmits<{
  again: []
}>()

const { resolve: resolveImage } = useImageUrl()

const image = computed(() =>
  resolveImage(props.track.releaseImage, props.track.releaseImageUrl, 'releases'),
)

</script>

<template>
  <div class="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
    <div class="flex items-center gap-4 p-4">
      <div class="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        <img
          v-if="image"
          :src="image"
          :alt="track.album"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
          <Compass :size="32" />
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <p class="truncate text-lg font-semibold text-zinc-50">{{ track.title }}</p>
        <p class="truncate text-sm text-zinc-400">{{ track.artist }}</p>
        <p class="truncate text-xs text-zinc-500">
          {{ track.album }}
          <span v-if="track.duration"> · {{ formatDuration(track.duration) }}</span>
        </p>
      </div>

      <button
        class="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-50 disabled:opacity-50"
        :disabled="isLoading"
        @click="emit('again')"
      >
        <RefreshCw :size="14" :class="isLoading && 'animate-spin'" />
        Again
      </button>
    </div>
  </div>
</template>
