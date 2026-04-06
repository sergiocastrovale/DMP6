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
    <div class="genre-border">
      <div class="aspect-square overflow-hidden rounded-sm bg-zinc-800">
        <PlaylistCoverMosaic :cover-images="playlist.coverImages" />
      </div>
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

<style scoped>
@property --angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.genre-border {
  border: 3px solid transparent;
  border-radius: 0.25rem;
  background:
    linear-gradient(var(--color-surface), var(--color-surface)) padding-box,
    conic-gradient(from var(--angle), #f59e0b, #fbbf24, #f59e0b, #d97706, #f59e0b) border-box;
  animation: rotate-gradient 3s linear infinite;
}

@keyframes rotate-gradient {
  to {
    --angle: 360deg;
  }
}
</style>
