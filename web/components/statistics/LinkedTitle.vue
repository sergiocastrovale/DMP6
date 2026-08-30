<script setup lang="ts">
defineProps<{
  title: string
  artistSlug?: string | null
}>()
</script>

<template>
  <NuxtLink v-if="artistSlug" :to="`/artist/${artistSlug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
    {{ title }}
  </NuxtLink>
  <span v-else class="text-stone-100">{{ title }}</span>
</template>
