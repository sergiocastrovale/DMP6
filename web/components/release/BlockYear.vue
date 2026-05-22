<template>
  <p
    v-if="release.year"
    class="text-xs text-ink0"
  >
    {{ release.year }}
  </p>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()
</script>