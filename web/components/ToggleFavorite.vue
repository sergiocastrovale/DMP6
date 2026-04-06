<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { Heart } from 'lucide-vue-next'

const player = usePlayerStore()
const isFavorite = ref(false)

const props = withDefaults(defineProps<{
  size?: number
}>(), {
  size: 18,
})

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
    await $fetch(`/api/favorites/tracks/${player.currentTrack?.id}`, {
      method: isFavorite.value ? 'DELETE' : 'POST',
    })
    isFavorite.value = !isFavorite.value
  }
  catch (error) {
    console.error('Failed to toggle favorite:', error)
  }
}

watch(() => player.currentTrack?.id, () => {
  if (player.currentTrack) {
    checkFavorite()
  }
})

onMounted(() => {
  if (player.currentTrack) {
    checkFavorite()
  }
})
</script>

<template>
  <button
    class="hidden lg:block text-zinc-400 hover:text-amber-500 transition-colors cursor-pointer"
    :class="{ 'text-amber-500': isFavorite }"
    @click="toggleFavorite"
  >
    <Heart :size="props.size" :fill="isFavorite ? 'currentColor' : 'none'" />
  </button>
</template>