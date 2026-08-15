<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'name', label: 'Genre', sortable: true },
  { key: 'artistCount', label: 'Artists', sortable: true, align: 'right' as const },
]
</script>

<template>
  <StatisticsStatPage title="Genres" api-type="genres" label="genres" default-sort="name" :columns="columns">
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <span class="text-sm text-ink">{{ item.name }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink-3">{{ item.artistCount }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
