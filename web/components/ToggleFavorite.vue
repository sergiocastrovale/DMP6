<script setup lang="ts">
import { Heart } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  // Controlled mode: parent already knows the favorite state (release/track rows) - pass it in and
  // no internal fetch happens, just an emitted `toggle`. Leave unset for the player bar / explore
  // card, which have no such prop to hand in and self-fetch/toggle favorite state for the current track.
  active?: boolean
  size?: number
  label?: string
  // The persistent bottom player bar hides this on narrow screens to save space; a page that
  // gives the toggle its own room (Explore's now-playing card) wants it visible everywhere.
  alwaysVisible?: boolean
}>(), {
  size: 18,
  alwaysVisible: false,
})

const emit = defineEmits<{ toggle: [] }>()

const isControlled = computed(() => props.active !== undefined)

const player = usePlayerStore()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')
const selfFavorite = ref(false)
const isFavorite = computed(() => isControlled.value ? props.active! : selfFavorite.value)

async function checkFavorite() {
  if (!player.currentTrack?.id) {
     return
  }
  
  try {
    const { isFavorite: fav } = await $fetch<{ isFavorite: boolean }>(`/api/favorites/tracks/${player.currentTrack.id}`)
    selfFavorite.value = fav
  }
  catch (error) {
    console.error('Failed to check favorite:', error)
  }
}

async function toggleSelf() {
  try {
    await $fetch(`/api/favorites/tracks/${player.currentTrack?.id}`, {
      method: selfFavorite.value ? 'DELETE' : 'POST',
    })
    selfFavorite.value = !selfFavorite.value
  }
  catch (error) {
    console.error('Failed to toggle favorite:', error)
  }
}

function handleClick() {
  isControlled.value ? emit('toggle') : toggleSelf()
}

watch(() => player.currentTrack?.id, () => {
  if (!isControlled.value && player.currentTrack) {
    checkFavorite()
  }
})

onMounted(() => {
  if (!isControlled.value && player.currentTrack) {
    checkFavorite()
  }
})
</script>

<template>
  <button
    v-if="isControlled || canCrud"
    type="button"
    :class="cx(
      !isControlled && !alwaysVisible ? 'hidden lg:block' : '',
      'transition-colors duration-150 cursor-pointer',
      isFavorite ? 'text-amber-400' : 'text-stone-100/60 hover:text-amber-400',
    )"
    :aria-label="label ?? (isFavorite ? 'Remove from favorites' : 'Add to favorites')"
    :title="label"
    @click.stop="handleClick"
  >
    <Heart :size="props.size" :fill="isFavorite ? 'currentColor' : 'none'" />
  </button>
</template>
