<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import { releaseTypeBuckets } from '~/helpers/constants'

withDefaults(defineProps<{
  defaultSort?: string
}>(), {
  defaultSort: 'name',
})

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Artist', sortable: true },
  ...releaseTypeBuckets.map(b => ({ key: b.id, label: b.shortLabel, sortable: true, align: 'center' as const })),
]
</script>

<template>
  <StatisticsStatPage
    title="Release Types"
    api-type="types"
    label="artists"
    :default-sort="defaultSort"
    :default-order="defaultSort === 'name' ? 'asc' : 'desc'"
    :columns="columns"
    :row-link="row => `/artist/${row.slug}`"
  >
    <template #cell-name="{ row }">
      <NuxtLink :to="`/artist/${row.slug}`" class="text-stone-100 transition-colors duration-150 hover:text-amber-400" @click.stop>
        {{ row.name }}
      </NuxtLink>
    </template>

    <template v-for="bucket in releaseTypeBuckets" :key="bucket.id" #[`cell-${bucket.id}`]="{ value, row }">
      <NuxtLink
        v-if="value"
        :to="`/statistics/types/${bucket.id}?artist=${row.slug}&name=${encodeURIComponent(row.name)}`"
        class="text-stone-100 transition-colors duration-150 hover:text-amber-400"
        @click.stop
      >
        {{ value }}
      </NuxtLink>
      <span v-else class="text-stone-100/25">0</span>
    </template>
  </StatisticsStatPage>
</template>
