<script setup lang="ts">
defineProps<{
  active?: boolean
  muted?: boolean
}>()
</script>

<template>
  <tr
    class="group border-b border-zinc-800/50 transition-colors last:border-b-0"
    :class="[
      active && 'bg-zinc-900/50',
      muted ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-zinc-800/50',
    ]"
  >
    <slot />
  </tr>
</template>
