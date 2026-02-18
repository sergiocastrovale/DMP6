<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { Heart } from 'lucide-vue-next'

const { isStreamMode } = useStreamMode()

const player = usePlayerStore()
const isFavorite = ref(false)

async function checkFavorite() {
  try {
    const favorites = await $fetch<any>('/api/favorites')
    isFavorite.value = favorites.tracks.some((fav: any) => fav.track.id === player.currentTrack?.id)
  }
  catch (error) {
    console.error('Failed to check favorite:', error)
  }
}

async function toggleFavorite() {
  try {
    await $fetch(`/api/favorites/tracks/${player.currentTrack?.id}`, { method: 'POST' })
    isFavorite.value = true
  }
  catch (error) {
    console.error('Failed to toggle favorite:', error)
  }
}

watch(() => player.currentTrack?.id, () => {
  if (player.currentTrack && !isStreamMode.value) {
    checkFavorite()
  }
})

onMounted(() => {
  if (player.currentTrack && !isStreamMode.value) {
    checkFavorite()
  }
})
</script>

<template>
  <button
    v-if="!isStreamMode"
    class="hidden lg:block text-zinc-400 hover:text-amber-500 transition-colors"
    :class="{ 'text-amber-500': isFavorite }"
    @click="toggleFavorite"
  >
    <Heart :size="18" :fill="isFavorite ? 'currentColor' : 'none'" />
  </button>
</template>