<script setup lang="ts">
import type { Artist } from '~/types/artist'
import DialogLinks from '~/components/artist/DialogLinks.vue'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Links from '~/components/artist/Links.vue'
import Genres from '~/components/artist/Genres.vue'
import AverageMatchScore from '~/components/artist/AverageMatchScore.vue'
import TotalTracks from '~/components/artist/TotalTracks.vue'
import TotalPlays from '~/components/artist/TotalPlays.vue'
import Initial from '~/components/artist/Initial.vue'

interface Props {
  artist: Artist
}

const props = defineProps<Props>()
  
const { artistImage } = useImageUrl()

const showAllGenres = ref(false)
const showAllLinks = ref(false)

const imgUrl = computed(() => artistImage(props.artist))
</script>

<template>
  <div class="flex flex-col gap-6 sm:flex-row sm:items-end">
    <div class="size-40 shrink-0 overflow-hidden rounded-xl bg-zinc-800 shadow-2xl sm:size-48">
      <img v-if="imgUrl" :src="imgUrl" :alt="artist.name" class="size-full object-cover" />
      <div v-else class="flex size-full items-center justify-center text-5xl font-bold text-zinc-600">
        <Initial :name="artist.name" />
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-bold text-zinc-50 sm:text-4xl">{{ artist.name }}</h1>

      <Genres :genres="artist.genres" @more="showAllGenres = true" />

      <div class="flex items-center gap-4 text-sm text-zinc-400">
        <TotalTracks :total="artist.totalTracks" />
        <TotalPlays :plays="artist.totalPlayCount" />
        <AverageMatchScore :score="artist.averageMatchScore" />
      </div>

      <Links :links="artist.urls" @more="showAllLinks = true" />
    </div>

    <DialogGenres v-model="showAllGenres" :genres="artist.genres" />
    <DialogLinks v-model="showAllLinks" :links="artist.urls" />
  </div>
</template>
