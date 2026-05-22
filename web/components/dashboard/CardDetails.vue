<script setup lang="ts">
import type { Release } from '~/types/release'

defineProps<{ release: Release }>()
</script>

<template>
  <div class="flex items-center gap-2 font-mono text-sm text-meta uppercase text-ink-4">
    <span v-if="release.year" class="shrink-0">{{ release.year }}</span>
    <Bullet v-if="release.year && release.genre" />
    <span v-if="release.genre" class="truncate min-w-0">{{ release.genre }}</span>
  </div>
</template>