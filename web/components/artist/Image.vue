<script setup lang="ts">
import type { Artist } from '~/types/artist'
import { useImageUrl } from '~/composables/useImageUrl'

const props = defineProps<{
  artist: Artist
  type?: 'mobile' | 'desktop'
}>()

const { artistImage } = useImageUrl()
const image = computed(() => artistImage(props.artist))
</script>

<template>
  <div v-if="type === 'mobile'">
    <div
      v-if="image"
      class="absolute inset-0 bg-cover bg-center"
      :style="{ backgroundImage: `url(${image})` }"
    />
    <div v-else class="absolute inset-0 bg-stone-800" />
    <div class="absolute inset-0 bg-black/88" />
  </div>
  <div v-else class="size-28 shrink-0 overflow-hidden rounded-xl border border-stone-100/6 bg-stone-800 sm:size-36">
    <img
      v-if="image"
      :src="image"
      :alt="artist.name"
      class="size-full object-cover"
    >
    <div v-else class="flex size-full items-center justify-center font-display text-4xl font-bold text-stone-100/20">
      {{ artist.name.charAt(0).toUpperCase() }}
    </div>
  </div>
</template>
