<template>
  <NuxtLink
    v-if="release.artist"
    :to="`/artist/${release.artist.slug}?release=${toReleaseSlug(release.title)}`"
    class="line-clamp-1 text-sm font-medium text-ink hover:text-accent transition-colors"
  >
    {{ release.title }}
  </NuxtLink>
  <p
    v-else
    class="line-clamp-1 text-sm font-medium text-ink"
  >
    {{ release.title }}
  </p>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()

const toReleaseSlug = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
</script>