<script setup lang="ts">
import type { Artist } from '~/types/artist'
import Initial from '~/components/artist/Initial.vue'

const props = defineProps<{
  artist: Artist
}>()

const { artistImage } = useImageUrl()
const imgUrl = computed(() => artistImage(props.artist))
</script>

<template>
  <img
    v-if="imgUrl"
    :src="imgUrl"
    :alt="props.artist.name"
    class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
    loading="lazy"
  />
  <div v-else class="flex size-full items-center justify-center text-3xl font-bold text-zinc-600">
    <Initial :name="props.artist.name" />
  </div>
</template> 