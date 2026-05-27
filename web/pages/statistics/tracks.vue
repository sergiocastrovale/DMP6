<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
]
</script>

<template>
  <StatisticsStatPage title="Tracks" api-type="tracks" label="tracks" default-sort="title" :columns="columns">
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <span class="text-sm text-ink">{{ item.title }}</span>
      </td>
      <td class="hidden px-4 py-2.5 md:table-cell">
        <span class="text-xs text-ink-2">{{ item.artistName }}</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
