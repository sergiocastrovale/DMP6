<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="flex items-end justify-between gap-4 flex-wrap pb-6 mb-8 border-b-2 border-rule">
    <h2 class="font-display text-mag-title font-normal tracking-[-0.035em] leading-none max-[980px]:text-[40px] max-[640px]:text-[22px]">
      {{ title }}
    </h2>
  </div>
</template>
