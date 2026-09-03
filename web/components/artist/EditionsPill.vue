<script setup lang="ts">
defineProps<{
  count: number
}>()
</script>

<template>
  <span class="absolute inset-y-0 left-0 w-px my-2 bg-amber-400/15 xl:hidden" />
  <span class="absolute right-full top-12 hidden translate-x-5.75 -translate-y-1/2 -rotate-90 whitespace-nowrap rounded-sm rounded-b-none border border-b-0 border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-2xs font-medium text-amber-400 xl:block">
    {{ count }} editions
  </span>
</template>