<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { Heart } from 'lucide-vue-next'

const player = usePlayerStore()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')
const isFavorite = ref(false)

const props = withDefaults(defineProps<{
  size?: number
}>(), {
  size: 18,
})

async function checkFavorite() {
  if (!player.currentTrack?.id) {return}
  try {
    const { isFavorite: fav } = await $fetch<{ isFavorite: boolean }>(`/api/favorites/tracks/${player.currentTrack.id}`)
    isFavorite.value = fav
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
    v-if="canCrud"
    class="hidden lg:block text-ink-2 hover:text-accent transition-colors cursor-pointer"
    :class="{ 'text-accent': isFavorite }"
    :aria-label="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
    @click="toggleFavorite"
  >
    <Heart :size="props.size" :fill="isFavorite ? 'currentColor' : 'none'" />
  </button>
</template>