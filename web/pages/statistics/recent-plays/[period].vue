<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import type { PlayPeriod } from '~/types/stats'
import { playPeriods } from '~/helpers/constants'
import { timeAgo } from '~/helpers/functions'

const PERIOD_IDS = new Set(playPeriods.map(p => p.id))

definePageMeta({
  layout: 'admin',
  validate: route => PERIOD_IDS.has(route.params.period as PlayPeriod),
})

const route = useRoute()
const period = route.params.period as PlayPeriod
const periodLabel = playPeriods.find(p => p.id === period)!.label

useTitle('Statistics', `${periodLabel} Plays`)

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
  { key: 'playedAt', label: 'Played', sortable: true, align: 'center' },
]
</script>

<template>
  <StatisticsStatPage
    :title="`${periodLabel} Plays`"
    api-type="recent-plays"
    label="plays"
    default-sort="playedAt"
    default-order="desc"
    :columns="columns"
    :extra-query="{ period }"
  >
    <template #cell-artist="{ row }">
      {{ row.artistName }}
    </template>
    <template #cell-playedAt="{ value }">
      {{ timeAgo(value as string) }}
    </template>
  </StatisticsStatPage>
</template>
