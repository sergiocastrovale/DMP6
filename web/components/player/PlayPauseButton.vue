<script setup lang="ts">
import { Pause, Play } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  playing?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
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
  xl: { icon: 32, circle: 'size-18' },
}
</script>

<template>
  <button
    type="button"
    class="flex items-center justify-center rounded-full transition-all duration-150 hover:bg-amber-400 hover:text-on-accent hover:scale-105"
    :class="[config[size].circle, highlighted && 'bg-amber-400 text-on-accent scale-105']"
    :aria-label="playing ? 'Pause' : 'Play'"
  >
    <Pause v-if="playing" :size="config[size].icon" fill="currentColor" />
    <Play v-else :size="config[size].icon" fill="currentColor" class="ml-px" />
  </button>
</template>
