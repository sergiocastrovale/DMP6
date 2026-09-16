<script setup lang="ts">
import type { Statistics } from '~/types/stats'
import { playPeriods } from '~/helpers/constants'
import { formatNumber } from '~/helpers/functions'
import { surface } from '~/helpers/ui'

defineProps<{
  stats: Statistics
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <NuxtLink
      v-for="period in playPeriods"
      :key="period.id"
      :to="`/statistics/recent-plays/${period.id}`"
      :class="[surface.card, 'flex flex-col items-center gap-1 p-4 text-center transition-colors duration-150 hover:border-stone-100/15']"
    >
      <p class="font-display text-2xl font-bold text-stone-100 tabular-nums">{{ formatNumber(stats.recentPlays[period.id]) }}</p>
      <p class="text-sm text-stone-100/55">{{ period.label }}</p>
    </NuxtLink>
  </div>
</template>
