<script setup lang="ts">
definePageMeta({ layout: 'admin' })
</script>

<template>
  <StatisticsStatPage
    title="Artists Synced"
    api-type="artists-synced"
    label="artists"
    default-sort="name"
    :columns="[{ key: 'name', label: 'Name', sortable: true }]"
  >
    <template #row="{ item }">
      <td class="px-4 py-2.5">
        <NuxtLink :to="`/artist/${item.slug}`" class="text-sm text-ink hover:text-accent transition-colors">
          {{ item.name }}
        </NuxtLink>
      </td>
    </template>
  </StatisticsStatPage>
</template>
