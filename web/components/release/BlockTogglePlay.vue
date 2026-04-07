<template>
  <button
    class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity"
    :class="playingClasses"
    @click="handleClick"
  >
    <LucidePause
      v-if="isPlaying"
      class="size-6"
      fill="currentColor"
    />
    <LucidePlay
      v-else
      class="size-6"
      fill="currentColor"
    />
  </button>
</template>

<script setup lang="ts">
import { LucidePlay, LucidePause } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()

const playerStore = usePlayerStore()
const isCurrent = computed(() => playerStore.currentTrack?.localReleaseId === props.release.id)
const isPlaying = computed(() => isCurrent.value && playerStore.isPlaying)

const playingClasses = computed(() => isPlaying.value ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')

const handleClick = () => isCurrent.value ? playerStore.togglePlay() : play()

const play = async () => {
  try {
    const response = await $fetch<any>(`/api/releases/${props.release.id}/tracks`)
    if (response?.tracks?.length > 0) {
      playerStore.playTrack(response.tracks[0], response.tracks)
    }
  }
  catch (error) {
    console.error('Failed to play release:', error)
  }
}
</script>