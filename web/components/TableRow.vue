<script setup lang="ts">
defineProps<{
  active?: boolean
  muted?: boolean
  expanded?: boolean
}>()
</script>

<template>
  <div
    class="border-b border-zinc-800 last:border-b-0 transition-colors"
    :class="[
      active && 'bg-zinc-800/30',
      (muted || expanded) ? 'cursor-default' : 'hover:bg-zinc-800/50',
    ]"
  >
    <div class="group flex items-center gap-3 p-3">
      <slot />
    </div>
    <slot name="expand" />
  </div>
</template>
