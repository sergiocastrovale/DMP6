<template>
  <NuxtLink
    :to="`/playlists/${playlist.slug}`"
    class="group flex flex-col gap-2"
  >
    <div :class="playlist.type === 'GENRE' ? 'genre-border' : ''">
      <div
        class="relative aspect-square overflow-hidden bg-zinc-800"
        :class="playlist.type === 'GENRE' ? 'rounded-sm' : 'rounded-lg'"
      >
        <PlaylistBlockImageMosaic :images="playlist.coverImages" />
        <PlaylistBlockTogglePlay :playlist="playlist" />
      </div>
    </div>
    <div class="flex flex-col gap-0.5">
      <PlaylistBlockName :playlist="playlist" />
      <PlaylistBlockMeta :playlist="playlist" />
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>

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
