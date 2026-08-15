<script setup lang="ts">
import { formatFileSize } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'name', label: 'Artist', sortable: true },
  { key: 'totalSize', label: 'Size', sortable: true, align: 'right' as const },
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
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <NuxtLink :to="`/artist/${item.slug}`" class="text-sm text-ink hover:text-accent transition-colors">
          {{ item.name }}
        </NuxtLink>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink-3">{{ formatFileSize(item.totalSize ?? 0) }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
