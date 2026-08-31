<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'
import { formatDuration } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', align: 'right' },
  { key: 'totalDuration', label: 'Duration', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage title="Shortest Releases" api-type="shortest" label="releases" default-sort="totalDuration" :columns="columns">
    <template #cell-title="{ row }">
      <StatisticsLinkedTitle :title="row.title" :artist-slug="row.artistSlug" />
    </template>
    <template #cell-totalDuration="{ value }">
      {{ formatDuration(value as number) }}
    </template>
    <template #actions="{ row }">
      <StatisticsRowActions :release-id="row.id" :artist-slug="row.artistSlug" :label="row.title" />
    </template>
  </StatisticsStatPage>
</template>
