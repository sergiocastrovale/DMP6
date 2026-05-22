<script setup lang="ts">
import { getScoreRange } from '~/helpers/constants'

const props = defineProps<{
  score: number | null
}>()

const matchClasses = computed(() => {
  if (props.score === null) {
    return 'bg-bg-3 text-ink-2'
  }
  const { bgColor, textColor } = getScoreRange(Math.round(props.score * 100))
  return `${bgColor} ${textColor}`
})
</script>

<template>
  <span
    v-if="score !== null"
    class="rounded-full px-2 py-0.5 text-xs font-medium"
    :class="matchClasses"
  >
    {{ Math.round(score * 100) }}% match
  </span>
</template>
