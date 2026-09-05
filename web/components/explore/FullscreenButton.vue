<script setup lang="ts">
import { Maximize, Minimize } from 'lucide-vue-next'

defineProps<{
  fullscreen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleFullscreen'): void
}>()
</script>

<template>
  <button data-testid="fullscreen-toggle" :aria-label="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" :title="fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" class="text-stone-100/60 hover:text-white active:text-white cursor-pointer" @click="emit('toggleFullscreen')">
    <Maximize v-if="!fullscreen" :size="16" />
    <Minimize v-else :size="16" />
  </button>
</template>