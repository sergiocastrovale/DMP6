<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import { formatFileSize } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Single-Release Artists')

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Artist', sortable: true },
  { key: 'releaseTitle', label: 'Release', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', sortable: true, align: 'center' },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'center' },
]
</script>

<template>
  <StatisticsStatPage
    title="Single-Release Artists"
    api-type="single-release"
    label="artists"
    default-sort="totalSize"
    :columns="columns"
    :row-link="row => `/artist/${row.slug}`"
  >
    <template #cell-name="{ row }">
      <NuxtLink :to="`/artist/${row.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150" @click.stop>
        {{ row.name }}
      </NuxtLink>
    </template>
    <template #cell-totalSize="{ value }">
      {{ formatFileSize((value as number) ?? 0) }}
    </template>
  </StatisticsStatPage>
</template>
