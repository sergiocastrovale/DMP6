<script setup lang="ts">
import { formatDate } from '~/helpers/functions'
import { layout } from '~/helpers/ui'

useTitle('Statistics')

definePageMeta({ layout: 'admin' })

const { loading, stats, tiles, sections } = useStatisticsPage()
</script>

<template>
  <div :class="layout.page">
    <PageTitle
      text="Statistics"
      :subtext="!loading && stats ? `Last scanned: ${formatDate(stats.lastScanEndedAt)}` : undefined"
    />

    <UiLoadingBlock v-if="loading" />

    <template v-else-if="stats">
      <StatisticsPlaytime :stats="stats" />
      <StatisticsRecentPlays :stats="stats" />
      <StatisticsTileGrid :tiles="tiles" />
      <StatisticsSectionCards :sections="sections" />
    </template>
  </div>
</template>
