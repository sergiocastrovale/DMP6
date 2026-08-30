<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
</script>

<template>
  <NuxtLink to="/labs" class="inline-flex items-center gap-1.5 text-sm text-stone-100/40 transition-colors duration-150 hover:text-stone-100/60">
    <ArrowLeft :size="14" />
    Back to Labs
  </NuxtLink>
</template>
