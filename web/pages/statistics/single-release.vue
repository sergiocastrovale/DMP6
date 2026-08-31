<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'
import { formatFileSize } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Artist', sortable: true },
  { key: 'releaseTitle', label: 'Release', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', sortable: true, align: 'right' },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage
    title="Single-Release Artists"
    api-type="single-release"
    label="artists"
    default-sort="totalSize"
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
    <template #actions="{ row }">
      <StatisticsRowActions :artist-slug="row.slug" :label="row.name" />
    </template>
  </StatisticsStatPage>
</template>
