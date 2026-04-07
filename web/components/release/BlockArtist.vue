<template>
  <NuxtLink
    v-if="release.artist"
    :to="`/artist/${release.artist.slug}`"
    class="line-clamp-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
  >
    {{ release.artist.name }}
  </NuxtLink>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()
</script>