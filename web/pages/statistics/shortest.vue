<script setup lang="ts">
import { formatDuration } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'trackCount', label: 'Tracks', align: 'right' as const },
  { key: 'totalDuration', label: 'Duration', sortable: true, align: 'right' as const },
]
</script>

<template>
  <StatisticsStatPage title="Shortest Releases" api-type="shortest" label="releases" default-sort="totalDuration" :columns="columns">
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <NuxtLink v-if="item.artistSlug" :to="`/artist/${item.artistSlug}`" class="text-sm text-ink hover:text-accent transition-colors">
          {{ item.title }}
        </NuxtLink>
        <span v-else class="text-sm text-ink">{{ item.title }}</span>
      </td>
      <td class="hidden px-4 py-2.5 md:table-cell">
        <span class="text-xs text-ink-2">{{ item.artistName }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink0">{{ item.trackCount }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink0">{{ formatDuration(item.totalDuration) }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
