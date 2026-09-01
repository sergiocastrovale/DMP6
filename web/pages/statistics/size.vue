<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import { formatFileSize } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Library Size')

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Artist', sortable: true },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage
    title="Disk Space by Artist"
    api-type="size"
    label="artists"
    default-sort="totalSize"
    default-order="desc"
    :columns="columns"
  >
    <template #cell-name="{ row }">
      <NuxtLink :to="`/artist/${row.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
        {{ row.name }}
      </NuxtLink>
    </template>
    <template #cell-totalSize="{ value }">
      {{ formatFileSize((value as number) ?? 0) }}
    </template>
  </StatisticsStatPage>
</template>
