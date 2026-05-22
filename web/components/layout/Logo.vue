<script setup lang="ts">
const { collapsed } = useSidebar()
</script>

<template>
  <NuxtLink to="/" class="flex items-center gap-2 px-2">
    <div class="flex size-9 items-center justify-center rounded bg-accent font-display text-xl font-bold text-accent-ink">
      D
    </div>
    <span
      v-if="!collapsed"
      class="font-display text-lg font-bold tracking-wide text-ink"
    >
      DMP
    </span>
  </NuxtLink>
</template>
