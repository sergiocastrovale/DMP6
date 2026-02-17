<script setup lang="ts">
const props = defineProps<{
  score: number | null
}>()

const matchClasses = computed(() => {
  if (props.score !== null) {
    if (props.score >= 0.8) {
      return 'bg-emerald-500/20 text-emerald-400'
    } else if (props.score >= 0.5) {
      return 'bg-amber-500/20 text-amber-400'
    } else {
      return 'bg-zinc-700 text-zinc-400'
    }
  }

  return 'bg-zinc-700 text-zinc-400'
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