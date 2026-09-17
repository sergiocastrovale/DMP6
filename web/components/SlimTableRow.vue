<script setup lang="ts">
import { cx } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  active?: boolean
  muted?: boolean
  highlight?: boolean
  // False for a table whose rows carry no click-through of their own (e.g. browse's summarized
  // list, where only specific cells link out) - without this the row still painted itself as
  // clickable (pointer cursor, hover fill) despite doing nothing on click.
  interactive?: boolean
}>(), {
  interactive: true,
})

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
      'group border-b border-stone-100/10 last:border-b-0 transition-colors duration-150',
      active && 'bg-amber-400/10',
      muted ? 'opacity-50 cursor-default' : (interactive && 'cursor-pointer hover:bg-stone-800'),
      flashing && 'animate-highlight-flash',
    )"
  >
    <slot />
  </tr>
</template>
