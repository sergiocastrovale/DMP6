<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })
useHead({ title: buildPageTitle('Statistics', 'Releases with Cover') })

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'artistName', label: 'Artist', class: 'hidden md:table-cell' },
  { key: 'year', label: 'Year', sortable: true, align: 'right' },
]
</script>

<template>
  <StatisticsStatPage title="Releases with Cover" api-type="releases-with-art" label="releases" default-sort="title" :columns="columns">
    <template #cell-title="{ row }">
      <StatisticsLinkedTitle :title="row.title" :artist-slug="row.artistSlug" />
    </template>
    <template #actions="{ row }">
      <StatisticsRowActions :release-id="row.id" :artist-slug="row.artistSlug" :label="row.title" />
    </template>
  </StatisticsStatPage>
</template>
