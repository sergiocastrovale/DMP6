<script setup lang="ts">
import { Heart } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx } from '~/helpers/ui'

const player = usePlayerStore()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')
const isFavorite = ref(false)

const props = withDefaults(defineProps<{
  size?: number
  // The persistent bottom player bar hides this on narrow screens to save space; a page that
  // gives the toggle its own room (Explore's now-playing card) wants it visible everywhere.
  alwaysVisible?: boolean
}>(), {
  size: 18,
  alwaysVisible: false,
})

async function checkFavorite() {
  if (!player.currentTrack?.id) { return }
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
    type="button"
    :class="cx(alwaysVisible ? 'block' : 'hidden lg:block', 'transition-colors duration-150 cursor-pointer', isFavorite ? 'text-amber-400' : 'text-stone-100/60 hover:text-amber-400')"
    :aria-label="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
    @click="toggleFavorite"
  >
    <Heart :size="props.size" :fill="isFavorite ? 'currentColor' : 'none'" />
  </button>
</template>
