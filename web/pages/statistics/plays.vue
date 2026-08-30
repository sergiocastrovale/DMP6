<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
  { key: 'playCount', label: 'Plays', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage
    title="Played Tracks"
    api-type="plays"
    label="tracks"
    default-sort="playCount"
    default-order="desc"
    :columns="columns"
  >
    <template #cell-artist="{ row }">
      {{ row.artistName }}
    </template>
    <template #cell-playCount="{ value }">
      {{ (value as number)?.toLocaleString() }}
    </template>
  </StatisticsStatPage>
</template>
