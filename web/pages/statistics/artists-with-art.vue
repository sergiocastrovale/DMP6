<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })
useHead({ title: buildPageTitle('Statistics', 'Artists with Photo') })

const columns: DataTableColumn[] = [{ key: 'name', label: 'Name', sortable: true }]
</script>

<template>
  <StatisticsStatPage title="Artists with Photo" api-type="artists-with-art" label="artists" default-sort="name" :columns="columns">
    <template #cell-name="{ row }">
      <NuxtLink :to="`/artist/${row.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
        {{ row.name }}
      </NuxtLink>
    </template>
    <template #actions="{ row }">
      <StatisticsRowActions :artist-slug="row.slug" :label="row.name" />
    </template>
  </StatisticsStatPage>
</template>
