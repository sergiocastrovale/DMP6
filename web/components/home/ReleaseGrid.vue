<template>
  <div class="flex flex-col gap-8">
    <!-- Section header -->
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-zinc-50">
        {{ title }}
      </h2>
      <NuxtLink
        v-if="viewMoreLink"
        :to="viewMoreLink"
        class="text-sm text-amber-500 hover:text-amber-600 transition-colors"
      >
        View all
      </NuxtLink>
    </div>

    <!-- Release grid -->
    <div
      v-if="releases.length > 0"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <div
        v-for="release in releases"
        :key="release.id"
        class="group flex flex-col gap-2"
      >
        <!-- Cover art with play button -->
        <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
          <img
            v-if="imageUrl(release)"
            :src="imageUrl(release)!"
            :alt="release.title"
            loading="lazy"
            class="h-full w-full object-cover transition-transform group-hover:scale-105"
          >
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-zinc-600"
          >
            <LucideMusic class="size-12" />
          </div>

          <!-- Play button overlay -->
          <button
            class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
            @click="playRelease(release.id)"
          >
            <div class="rounded-full bg-amber-500 p-3 text-zinc-950 shadow-lg">
              <LucidePlay class="size-6" fill="currentColor" />
            </div>
          </button>
        </div>

        <!-- Release info -->
        <div class="flex flex-col gap-0.5">
          <NuxtLink
            v-if="release.artist"
            :to="`/artist/${release.artist.slug}`"
            class="line-clamp-1 text-sm font-medium text-zinc-50 hover:text-amber-500 transition-colors"
          >
            {{ release.title }}
          </NuxtLink>
          <p v-else class="line-clamp-1 text-sm font-medium text-zinc-50">
            {{ release.title }}
          </p>

          <NuxtLink
            v-if="release.artist"
            :to="`/artist/${release.artist.slug}`"
            class="line-clamp-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            {{ release.artist.name }}
          </NuxtLink>

          <p v-if="release.year" class="text-xs text-zinc-500">
            {{ release.year }}
          </p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-12 text-center text-zinc-500"
    >
      <LucideDisc class="mb-3 size-12 opacity-50" />
      <p>{{ emptyMessage }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LucidePlay, LucideMusic, LucideDisc } from 'lucide-vue-next'
import type { SearchRelease } from '~/types/search'

interface Props {
  title: string
  releases: SearchRelease[]
  viewMoreLink?: string
  emptyMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  viewMoreLink: undefined,
  emptyMessage: 'No releases found',
})

const { releaseImage } = useImageUrl()
const playerStore = usePlayerStore()

function imageUrl(release: SearchRelease) {
  return releaseImage(release)
}

async function playRelease(releaseId: string) {
  try {
    const response = await $fetch<any>(`/api/releases/${releaseId}/tracks`)
    if (response?.tracks?.length > 0) {
      const playerTracks = response.tracks.map((t: any) => ({
        id: t.id,
        title: t.title || 'Unknown',
        artist: t.artist || 'Unknown',
        album: response.release?.title || 'Unknown',
        duration: t.duration || 0,
        artistSlug: response.release?.artistSlug || null,
        releaseImage: response.release?.image ? `/img/releases/${response.release.image}` : null,
        releaseImageUrl: response.release?.imageUrl || null,
        localReleaseId: t.localReleaseId,
      }))
      playerStore.setQueue(playerTracks)
    }
  }
  catch (error) {
    console.error('Failed to load release tracks:', error)
  }
}
</script>
