<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'

definePageMeta({ layout: 'admin' })

const columns: DataTableColumn[] = [{ key: 'name', label: 'Name', sortable: true }]
</script>

<template>
  <StatisticsStatPage title="Artists" api-type="artists" label="artists" default-sort="name" :columns="columns">
    <template #cell-name="{ row }">
      <NuxtLink :to="`/artist/${row.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
        {{ row.name }}
      </NuxtLink>
    </template>
  </StatisticsStatPage>
</template>
