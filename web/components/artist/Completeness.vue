<script setup lang="ts">
import { getCompletenessRange } from '~/helpers/constants'

const props = defineProps<{
  completeness: number | null
}>()

const pillClasses = computed(() => {
  if (props.completeness === null) {
    return 'bg-stone-800 text-stone-100/60'
  }
  const { bgColor, textColor } = getCompletenessRange(Math.round(props.completeness * 100))
  return `${bgColor} ${textColor}`
})
</script>

<template>
  <span
    v-if="completeness !== null"
    class="rounded-full px-2 py-0.5 text-xs font-medium"
    :class="pillClasses"
  >
    {{ Math.round(completeness * 100) }}% complete
  </span>
</template>
