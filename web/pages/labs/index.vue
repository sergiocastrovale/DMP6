<script setup lang="ts">
import { Globe, Grid3x3, Dna, Clock, Network } from 'lucide-vue-next'

definePageMeta({ layout: 'default' })

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
  {
    to: '/labs/genome',
    title: 'Genre Genome',
    description: 'Interactive force graph showing genre relationships through shared artists.',
    icon: Dna,
  },
  {
    to: '/labs/decades',
    title: 'Decade DNA',
    description: 'Radar charts comparing your collection across decades - genres, quality, diversity.',
    icon: Clock,
  },
  {
    to: '/labs/network',
    title: 'Artist Network',
    description: 'Collaboration graph showing artist connections through shared tracks.',
    icon: Network,
  },
]
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageTitle text="Labs" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="lab in labs"
        :key="lab.to"
        :to="lab.to"
        class="group rounded-xl border border-stone-100/6 bg-stone-900 p-5 transition-colors duration-150 hover:border-stone-100/10 hover:bg-stone-800/50"
      >
        <div class="mb-3 flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
          <component :is="lab.icon" :size="20" class="text-amber-400" />
        </div>
        <h2 class="mb-1 text-lg font-semibold text-stone-100">{{ lab.title }}</h2>
        <p class="text-sm leading-relaxed text-stone-100/40">{{ lab.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
