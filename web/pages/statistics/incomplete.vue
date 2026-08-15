<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const STATUS_LABELS: Record<string, string> = {
  INCOMPLETE: 'Incomplete',
  MISSING_TRACKS: 'Missing tracks',
}

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'year', label: 'Year', sortable: true, align: 'right' as const },
  { key: 'matchStatus', label: 'Status', sortable: true },
]
</script>

<template>
  <StatisticsStatPage title="Incomplete Releases" api-type="incomplete" label="releases" default-sort="title" :columns="columns">
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
        <span class="text-xs tabular-nums text-ink-3">{{ item.year }}</span>
      </td>
      <td class="px-4 py-2.5">
        <span class="text-xs text-ink-3">{{ STATUS_LABELS[item.matchStatus] ?? item.matchStatus }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
