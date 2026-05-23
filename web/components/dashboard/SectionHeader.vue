<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="flex items-end justify-between gap-4 flex-wrap pb-4 my-5 border-b-2 border-rule">
    <h2 class="font-display text-3xl text-ink tracking-[-0.02em] leading-none">
      {{ title }}
    </h2>
  </div>
</template>
