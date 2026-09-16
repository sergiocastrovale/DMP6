<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Incomplete Releases')

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'year', label: 'Year', sortable: true, align: 'center' },
  { key: 'matchStatus', label: 'Status', sortable: true },
]
</script>

<template>
  <StatisticsStatPage title="Incomplete Releases" api-type="incomplete" label="releases" default-sort="title" :columns="columns" :row-link="row => row.artistSlug && `/artist/${row.artistSlug}`">
    <template #cell-title="{ row }">
      <StatisticsLinkedTitle :title="row.title" :artist-slug="row.artistSlug" />
    </template>
    <template #cell-matchStatus="{ value }">
      <ReleaseStatusBadge :status="value as any" />
    </template>
  </StatisticsStatPage>
</template>
