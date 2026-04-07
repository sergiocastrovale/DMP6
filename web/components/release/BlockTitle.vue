<template>
  <NuxtLink
    v-if="release.artist"
    :to="`/artist/${release.artist.slug}`"
    class="line-clamp-1 text-sm font-medium text-zinc-50 hover:text-amber-500 transition-colors"
  >
    {{ release.title }}
  </NuxtLink>
  <p
    v-else
    class="line-clamp-1 text-sm font-medium text-zinc-50"
  >
    {{ release.title }}
  </p>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()
</script>