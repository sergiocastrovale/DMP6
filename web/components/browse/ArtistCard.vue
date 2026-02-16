<script setup lang="ts">
import type { ArtistListItem } from '~/types/artist'

const props = defineProps<{
  artist: ArtistListItem
}>()

const { artistImage } = useImageUrl()
const imgUrl = computed(() => artistImage(props.artist))
</script>

<template>
  <NuxtLink
    :to="`/artist/${artist.slug}`"
    class="group flex flex-col gap-2 rounded-lg p-3 transition-colors hover:bg-zinc-900"
  >
    <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-800">
      <img
        v-if="imgUrl"
        :src="imgUrl"
        :alt="artist.name"
        class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
      />
      <div v-else class="flex size-full items-center justify-center text-3xl font-bold text-zinc-600">
        {{ artist.name.charAt(0).toUpperCase() }}
      </div>
    </div>
    <div class="min-w-0">
      <p class="truncate text-sm font-medium text-zinc-50">{{ artist.name }}</p>
      <div class="flex items-center gap-2 text-xs text-zinc-400">
        <span>{{ artist.totalTracks }} tracks</span>
        <span
          v-if="artist.averageMatchScore !== null"
          class="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          :class="
            artist.averageMatchScore >= 0.8
              ? 'bg-emerald-500/20 text-emerald-400'
              : artist.averageMatchScore >= 0.5
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-zinc-700 text-zinc-400'
          "
        >
          {{ Math.round(artist.averageMatchScore * 100) }}%
        </span>
      </div>
    </div>
  </NuxtLink>
</template>
