<script setup lang="ts">
import type { Confidence } from '~/types/issues'

const props = defineProps<{ confidence: Confidence }>()

const colors: Record<Confidence, string> = {
  high: 'bg-green-900/40 text-green-400',
  medium: 'bg-accent-soft text-accent',
  low: 'bg-red-900/40 text-red-400',
}
</script>

<template>
  <span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" :class="colors[confidence]">
    {{ confidence }}
  </span>
</template>
