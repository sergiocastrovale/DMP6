<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Tracks')

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
]
</script>

<template>
  <StatisticsStatPage title="Tracks" api-type="tracks" label="tracks" default-sort="title" :columns="columns">
    <template #cell-artist="{ row }">
      {{ row.artistName }}
    </template>
  </StatisticsStatPage>
</template>
