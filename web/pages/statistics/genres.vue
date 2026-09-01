<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'

definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Genres')

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Genre', sortable: true },
  { key: 'artistCount', label: 'Artists', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage title="Genres" api-type="genres" label="genres" default-sort="name" :columns="columns" />
</template>
