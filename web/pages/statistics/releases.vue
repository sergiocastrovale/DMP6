<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'year', label: 'Year', sortable: true, align: 'right' as const },
]
</script>

<template>
  <StatisticsStatPage title="Releases" api-type="releases" label="releases" default-sort="title" :columns="columns">
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
        <span class="text-xs tabular-nums text-ink0">{{ item.year }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
