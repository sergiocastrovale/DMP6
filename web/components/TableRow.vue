<script setup lang="ts">
defineProps<{
  active?: boolean
  muted?: boolean
  expanded?: boolean
}>()
</script>

<template>
  <div
    class="border-b border-rule last:border-b-0 transition-colors"
    :class="[
      active && 'bg-bg-2/30',
      (muted || expanded) ? 'cursor-default' : 'hover:bg-bg-2/50',
    ]"
  >
    <div class="group flex items-center gap-3 p-3">
      <slot />
    </div>
    <slot name="expand" />
  </div>
</template>
