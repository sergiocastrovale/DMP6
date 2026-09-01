<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Low Bitrate Tracks')

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
  { key: 'bitrate', label: 'Bitrate', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage title="Low Bitrate Tracks" api-type="bitrate" label="tracks" default-sort="bitrate" :columns="columns">
    <template #cell-artist="{ row }">
      {{ row.artistName }}
    </template>
    <template #cell-bitrate="{ value }">
      {{ value }} kbps
    </template>
  </StatisticsStatPage>
</template>
