<script setup lang="ts">
import { AudioLines } from 'lucide-vue-next'
import type { ButtonSize, ButtonVariant } from '~/types/ui'

// One definition, two call sites (the player bar's right-hand cluster and Explore's header), which
// is why the variant/size are props: each has to match the buttons it sits beside.
withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
}>(), {
  variant: 'ghost',
  size: 'lg',
})

const { active, available, toggle } = useVisualizer()
</script>

<template>
  <button data-testid="visualizer-toggle" :aria-label="available ? 'Visualizer' : 'Play something to use the visualizer'" :title="available ? 'Visualizer' : 'Play something to use the visualizer'" :aria-pressed="active" :disabled="!available" class="text-stone-100/60 cursor-pointer" @click="toggle()">
    <AudioLines :size="16" />
  </button>
</template>
