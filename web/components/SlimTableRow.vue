<script setup lang="ts">
import { cx } from '~/helpers/ui'

const props = defineProps<{
  active?: boolean
  muted?: boolean
  highlight?: boolean
}>()

const flashing = ref(false)
const rowRef = ref<HTMLElement>()

watch(() => props.highlight, (val) => {
  if (val) {
    flashing.value = true
    nextTick(() => {
      rowRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setTimeout(() => { flashing.value = false }, 1000)
  }
}, { immediate: true })
</script>

<template>
  <tr
    ref="rowRef"
    :class="cx(
      'group border-b border-stone-100/6 last:border-b-0 transition-colors duration-150',
      active && 'bg-amber-400/10',
      muted ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-stone-800',
      flashing && 'animate-highlight-flash',
    )"
  >
    <slot />
  </tr>
</template>
