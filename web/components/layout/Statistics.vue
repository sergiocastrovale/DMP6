<script setup lang="ts">
import { useGlobalStore } from '~/stores/global'
import { formatNumber, formatFileSize } from '~/helpers/functions'

const global = useGlobalStore()

const stats = computed(() => [
  { label: 'Artists', value: formatNumber(global.stats.artists) },
  { label: 'Releases', value: formatNumber(global.stats.releases) },
  { label: 'Tracks', value: formatNumber(global.stats.tracks) },
  { label: 'Genres', value: formatNumber(global.stats.genres) },
  { label: 'Total Plays', value: formatNumber(global.stats.totalPlays) },
  { label: 'Playtime', value: `${formatNumber(global.playtimeHours)}h ${global.playtimeMinutes}m` },
  { label: 'Size', value: formatFileSize(global.stats.totalFileSize) },
])
</script>

<template>
  <div class="flex items-center gap-5">
    <template v-for="(stat, i) in stats" :key="stat.label">
      <div v-if="i > 0" class="w-px self-stretch bg-rule my-1" />
      <div class="flex flex-col gap-0 leading-none">
        <div class="font-display font-semibold text-ink tabular-nums">
          {{ stat.value }}
        </div>
        <div class="font-mono text-xs uppercase text-ink-4 mt-1.5">
          {{ stat.label }}
        </div>
      </div>
    </template>
  </div>
</template>
