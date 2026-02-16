<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  artist: {
    name: string
    image: string | null
    imageUrl: string | null
    averageMatchScore: number | null
    totalTracks: number
    totalPlayCount: number
    genres: { id: string; name: string }[]
    urls: { id: string; type: string; url: string }[]
  }
}>()

const { artistImage } = useImageUrl()
const imgUrl = computed(() => artistImage(props.artist))
</script>

<template>
  <div class="flex flex-col gap-6 sm:flex-row sm:items-end">
    <!-- Image -->
    <div class="size-40 shrink-0 overflow-hidden rounded-xl bg-zinc-800 shadow-2xl sm:size-48">
      <img v-if="imgUrl" :src="imgUrl" :alt="artist.name" class="size-full object-cover" />
      <div v-else class="flex size-full items-center justify-center text-5xl font-bold text-zinc-600">
        {{ artist.name.charAt(0).toUpperCase() }}
      </div>
    </div>

    <!-- Info -->
    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-bold text-zinc-50 sm:text-4xl">{{ artist.name }}</h1>

      <!-- Genres -->
      <div v-if="artist.genres.length" class="flex flex-wrap gap-1.5">
        <span
          v-for="genre in artist.genres"
          :key="genre.id"
          class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300"
        >
          {{ genre.name }}
        </span>
      </div>

      <!-- Stats -->
      <div class="flex items-center gap-4 text-sm text-zinc-400">
        <span>{{ artist.totalTracks.toLocaleString() }} tracks</span>
        <span>{{ artist.totalPlayCount.toLocaleString() }} plays</span>
        <span
          v-if="artist.averageMatchScore !== null"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="
            artist.averageMatchScore >= 0.8
              ? 'bg-emerald-500/20 text-emerald-400'
              : artist.averageMatchScore >= 0.5
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-zinc-700 text-zinc-400'
          "
        >
          {{ Math.round(artist.averageMatchScore * 100) }}% match
        </span>
      </div>

      <!-- URLs -->
      <div v-if="artist.urls.length" class="flex flex-wrap gap-2 mt-1">
        <a
          v-for="link in artist.urls.slice(0, 5)"
          :key="link.id"
          :href="link.url"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-50 transition-colors"
        >
          <ExternalLink :size="10" />
          {{ link.type }}
        </a>
      </div>
    </div>
  </div>
</template>
