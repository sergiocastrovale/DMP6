<script setup lang="ts">
import { LucidePlus } from 'lucide-vue-next'

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent"
    @click="$emit('click')"
  >
    <LucidePlus class="inline size-4 -mt-0.5" />
    New Playlist
  </button>
</template>
