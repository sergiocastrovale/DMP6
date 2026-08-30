<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>

<template>
  <NuxtLink :to="`/playlists/${playlist.slug}`" class="group flex flex-col gap-2.5">
    <div :class="playlist.type !== 'MANUAL' ? 'genre-border p-0.5' : ''">
      <div class="relative aspect-square overflow-hidden rounded-lg bg-stone-800">
        <PlaylistBlockImageMosaic :images="playlist.coverImages" />
        <PlaylistBlockTogglePlay :playlist="playlist" />
      </div>
    </div>
    <div class="flex flex-col gap-0.5 min-w-0">
      <PlaylistBlockName :playlist="playlist" />
      <PlaylistBlockMeta :playlist="playlist" />
    </div>
  </NuxtLink>
</template>
