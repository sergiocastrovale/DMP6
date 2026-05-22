<script setup lang="ts">
import { ArrowLeft, FlaskConical } from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { to: '/labs/mosaic', label: 'Mosaic' },
]
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-rule bg-bg/80 backdrop-blur-sm">
    <div class="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 lg:px-8">
      <NuxtLink to="/" class="flex items-center gap-2 text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft :size="18" />
      </NuxtLink>

      <div class="flex items-center gap-2">
        <FlaskConical :size="18" class="text-accent" />
        <span class="text-sm font-semibold text-ink">Labs</span>
      </div>

      <nav class="ml-4 flex items-center gap-1">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="route.path === item.to
            ? 'bg-bg-2 text-accent'
            : 'text-ink-2 hover:bg-bg-1 hover:text-ink'"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>
