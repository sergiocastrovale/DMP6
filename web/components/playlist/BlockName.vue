<template>
  <p class="line-clamp-1 text-lg font-semibold text-stone-100 transition-colors duration-150 group-hover:text-amber-400">
    {{ playlist.name }}
  </p>
</template>

<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>
