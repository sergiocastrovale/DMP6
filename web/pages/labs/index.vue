<script setup lang="ts">
import { Globe, Grid3x3 } from 'lucide-vue-next'

definePageMeta({ layout: 'labs' })

const labs = [
  {
    to: '/labs/mosaic',
    title: 'Album Mosaic',
    description: 'Generate a giant mosaic from all your album covers, randomly arranged.',
    icon: Grid3x3,
  },
  {
    to: '/labs/map',
    title: 'World Map',
    description: 'Album art tiled across a world map by artist origin.',
    icon: Globe,
  },
]
</script>

<template>
  <div>
    <h1 class="mb-6 text-2xl font-bold">Labs</h1>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="lab in labs"
        :key="lab.to"
        :to="lab.to"
        class="group rounded-lg border border-rule bg-bg-1 p-5 transition-colors hover:border-rule hover:bg-bg-2/50"
      >
        <div class="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent/10">
          <component :is="lab.icon" :size="20" class="text-accent" />
        </div>
        <h2 class="mb-1 text-sm font-semibold text-ink">{{ lab.title }}</h2>
        <p class="text-xs leading-relaxed text-ink-2">{{ lab.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
