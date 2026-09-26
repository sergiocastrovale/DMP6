<script setup lang="ts">
defineProps<{
  current: number
  total: number
  percent: number
}>()
</script>

<template>
  <div class="pointer-events-none absolute left-4 right-4 top-4 z-[1000]">
    <div class="mx-auto max-w-xs overflow-hidden rounded-full bg-stone-800/80 backdrop-blur">
      <div
        class="h-1.5 rounded-full bg-amber-400 transition-all duration-300"
        :style="{ width: `${percent}%` }"
      />
    </div>
    <div class="mt-1 text-center text-sm text-stone-100/60">
      {{ current }}/{{ total }}
    </div>
  </div>
</template>
