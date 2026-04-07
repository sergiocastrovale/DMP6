<template>
  <p class="line-clamp-1 text-sm font-medium text-zinc-50 group-hover:text-amber-500 transition-colors">
    {{ playlist.name }}
  </p>
</template>

<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>
