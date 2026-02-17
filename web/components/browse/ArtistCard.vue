<script setup lang="ts">
import type { Artist } from '~/types/artist'  
import TotalTracks from '~/components/artist/TotalTracks.vue'
import AverageMatchScore from '~/components/artist/AverageMatchScore.vue'
import Cover from '~/components/artist/Cover.vue'

const props = defineProps<{
  artist: Artist
}>()
</script>

<template>
  <NuxtLink
    :to="`/artist/${artist.slug}`"
    class="group flex flex-col gap-2 rounded-lg p-3 transition-colors hover:bg-zinc-900"
  >
    <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-800">
      <Cover :artist="artist" />
    </div>
    <div class="min-w-0">
      <h3 class="truncate text-sm font-medium text-zinc-50">{{ artist.name }}</h3>
      <div class="flex items-center justify-between gap-2 text-xs text-zinc-400">
        <TotalTracks :total="artist.totalTracks" />
        <AverageMatchScore :score="artist.averageMatchScore" />
      </div>
    </div>
  </NuxtLink>
</template>
