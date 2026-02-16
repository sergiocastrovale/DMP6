<template>
  <div
    class="animate-pulse rounded-lg bg-zinc-800"
    :class="props.class"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  class?: string
}>()
</script>
