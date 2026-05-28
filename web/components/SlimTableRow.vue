<script setup lang="ts">
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
    class="group border-b border-rule/50 transition-colors last:border-b-0"
    :class="[
      active && 'bg-bg-1/50',
      muted ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-bg-2/50',
      flashing && 'animate-highlight-flash',
    ]"
  >
    <slot />
  </tr>
</template>
