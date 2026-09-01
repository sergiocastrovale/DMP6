<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Releases Synced')

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'year', label: 'Year', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage title="Releases Synced" api-type="releases-synced" label="releases" default-sort="title" :columns="columns">
    <template #cell-title="{ row }">
      <StatisticsLinkedTitle :title="row.title" :artist-slug="row.artistSlug" />
    </template>
  </StatisticsStatPage>
</template>
