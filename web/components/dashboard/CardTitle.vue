<script setup lang="ts">
import type { Release } from '~/types/release'

defineProps<{ release: Release }>()
</script>

<template>
  <NuxtLink>
    <div class="font-display font-semibold text-card-title text-ink truncate">
      {{ release.title }}
    </div>
    <div
      v-if="release.artist"
      :to="`/artist/${release.artist.slug}`"
      class="text-card-artist text-ink-2 truncate hover:text-ink transition-colors"
      @click.stop
    >
      {{ release.artist.name }}
    </div> 
  </NuxtLink>
</template>