<script setup lang="ts">
definePageMeta({ layout: 'admin' })
useTitle('Statistics', 'Release Types')

// Index page's Release Types items link here with ?sort=<bucket> so "Live albums -> 42" jumps
// straight into the table sorted by that column, descending (the interesting direction for a count).
const route = useRoute()
const initialSort = (route.query.sort as string) || 'name'
</script>

<template>
  <StatisticsTypesPage :default-sort="initialSort" />
</template>
