<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  text: string
  subtext?: string
  icon?: Component
}>()
</script>

<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <component :is="icon" v-if="icon" :size="24" class="shrink-0 text-accent" />
      <div>
        <h1 class="text-4xl font-bold text-ink">{{ text }}</h1>
        <p v-if="subtext" class="mt-0.5 text-sm text-ink-3">{{ subtext }}</p>
      </div>
    </div>
    <slot />
  </div>
</template>
