<template>
  <p class="line-clamp-1 text-sm font-medium text-ink group-hover:text-accent transition-colors">
    {{ playlist.name }}
  </p>
</template>

<script setup lang="ts">
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{ playlist: PlaylistSummary }>()
</script>
