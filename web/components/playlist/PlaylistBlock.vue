<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{
  playlist: PlaylistSummary
}>()
</script>

<template>
  <NuxtLink
    :to="`/playlists/${playlist.slug}`"
    class="group flex flex-col gap-2"
  >
    <div class="relative aspect-square overflow-hidden rounded-sm bg-zinc-800">
      <PlaylistCoverMosaic :cover-images="playlist.coverImages" />
    </div>

    <div class="flex flex-col gap-0.5">
      <p class="line-clamp-1 text-sm font-medium text-zinc-50 group-hover:text-amber-500 transition-colors">
        {{ playlist.name }}
      </p>
      <p class="text-xs text-zinc-500">
        {{ playlist.trackCount }} {{ playlist.trackCount === 1 ? 'track' : 'tracks' }}
      </p>
    </div>
  </NuxtLink>
</template>
