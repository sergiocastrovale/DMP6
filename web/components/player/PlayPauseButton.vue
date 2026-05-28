<script setup lang="ts">
import { Play, Pause } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  playing?: boolean
  size?: 'sm' | 'md' | 'lg'
  highlighted?: boolean
}>(), {
  playing: false,
  size: 'md',
  highlighted: false,
})

const config = {
  sm: { icon: 14, circle: 'size-8' },
  md: { icon: 16, circle: 'size-10' },
  lg: { icon: 20, circle: 'size-11' },
}
</script>

<template>
  <button
    type="button"
    class="flex items-center justify-center rounded-full transition-all hover:bg-accent hover:text-accent-ink hover:scale-105"
    :class="[config[size].circle, highlighted && 'bg-accent text-accent-ink scale-105']"
    :aria-label="playing ? 'Pause' : 'Play'"
  >
    <Pause v-if="playing" :size="config[size].icon" fill="currentColor" />
    <Play v-else :size="config[size].icon" fill="currentColor" class="ml-px" />
  </button>
</template>
