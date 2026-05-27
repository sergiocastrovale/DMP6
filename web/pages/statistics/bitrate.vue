<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artist', label: 'Artist', sortable: true, class: 'hidden md:table-cell' },
  { key: 'bitrate', label: 'Bitrate', sortable: true, align: 'right' as const },
]
</script>

<template>
  <StatisticsStatPage title="Low Bitrate Tracks" api-type="bitrate" label="tracks" default-sort="bitrate" :columns="columns">
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <span class="text-sm text-ink">{{ item.title }}</span>
      </td>
      <td class="hidden px-4 py-2.5 md:table-cell">
        <span class="text-xs text-ink-2">{{ item.artistName }}</span>
      </td>
      <td class="px-4 py-2.5 text-right">
        <span class="text-xs tabular-nums text-ink0">{{ item.bitrate }} kbps</span>
      </td>
    </template>
  </StatisticsStatPage>
</template>
