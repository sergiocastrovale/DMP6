<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import { formatDuration } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Shortest Releases')

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', align: 'center' },
  { key: 'totalDuration', label: 'Duration', sortable: true, align: 'center' },
]
</script>

<template>
  <StatisticsStatPage title="Shortest Releases" api-type="shortest" label="releases" default-sort="totalDuration" :columns="columns" :row-link="row => row.artistSlug && `/artist/${row.artistSlug}`">
    <template #cell-title="{ row }">
      <StatisticsLinkedTitle :title="row.title" :artist-slug="row.artistSlug" />
    </template>
    <template #cell-totalDuration="{ value }">
      {{ formatDuration(value as number) }}
    </template>
  </StatisticsStatPage>
</template>
