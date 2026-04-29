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
      <component :is="icon" v-if="icon" :size="24" class="shrink-0 text-amber-500" />
      <div>
        <h1 class="text-2xl font-bold text-zinc-50">{{ text }}</h1>
        <p v-if="subtext" class="mt-0.5 text-sm text-zinc-500">{{ subtext }}</p>
      </div>
    </div>
    <slot />
  </div>
</template>
