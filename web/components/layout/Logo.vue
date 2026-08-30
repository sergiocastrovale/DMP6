<script setup lang="ts">
const { collapsed } = useSidebar()
</script>

<template>
  <NuxtLink to="/" class="flex items-center gap-2 px-2">
    <div class="flex size-9 items-center justify-center rounded-md bg-amber-400 font-display text-xl font-bold text-on-accent shadow-accent">
      D
    </div>
    <span
      v-if="!collapsed"
      class="font-display text-lg font-bold tracking-wide text-stone-100"
    >
      DMP
    </span>
  </NuxtLink>
</template>
