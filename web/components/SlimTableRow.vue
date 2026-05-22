<script setup lang="ts">
defineProps<{
  active?: boolean
  muted?: boolean
}>()
</script>

<template>
  <tr
    class="group border-b border-rule/50 transition-colors last:border-b-0"
    :class="[
      active && 'bg-bg-1/50',
      muted ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-bg-2/50',
    ]"
  >
    <slot />
  </tr>
</template>
