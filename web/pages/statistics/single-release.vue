<script setup lang="ts">
import { formatFileSize } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'name', label: 'Artist', sortable: true },
  { key: 'releaseTitle', label: 'Release', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', sortable: true, align: 'right' as const },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'right' as const },
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
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <NuxtLink :to="`/artist/${item.slug}`" class="text-sm text-ink hover:text-accent transition-colors">
          {{ item.name }}
        </NuxtLink>
      </td>
      <td class="hidden px-4 py-2.5 md:table-cell">
        <span class="text-xs text-ink-2">{{ item.releaseTitle }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink0">{{ item.trackCount }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink0">{{ formatFileSize(item.totalSize ?? 0) }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
