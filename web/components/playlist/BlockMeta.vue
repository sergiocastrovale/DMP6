<template>
  <p class="text-xs text-zinc-500">
    {{ playlist.trackCount }} {{ playlist.trackCount === 1 ? 'track' : 'tracks' }}
  </p>
</template>

<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>
