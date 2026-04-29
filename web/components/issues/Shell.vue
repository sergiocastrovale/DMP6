<script setup lang="ts">
import { useIssuesStore } from '~/stores/issues'

const issuesStore = useIssuesStore()

const tabs = computed(() => [
  { key: 'overview', label: 'Overview', href: '/issues' },
  { key: 'corrupted', label: 'Corrupted TPE2', href: '/issues/corrupted', count: issuesStore.summary?.counts.corrupted, countHighlight: true },
  { key: 'unsplit', label: 'Unsplit Artists', href: '/issues/unsplit', count: issuesStore.summary?.counts.unsplit, countHighlight: true },
  { key: 'orphans', label: 'Orphans', href: '/issues/orphans', count: issuesStore.summary?.counts.orphans, countHighlight: true },
  { key: 'duplicates', label: 'Duplicates', href: '/issues/duplicates', count: issuesStore.summary?.counts.duplicates, countHighlight: true },
  { key: 'missing', label: 'Missing Metadata', href: '/issues/missing', count: issuesStore.summary?.counts.missing, countHighlight: true },
  { key: 'enrichment', label: 'Enrichment', href: '/issues/enrichment', count: issuesStore.summary?.counts.enrichment, countHighlight: true },
])
</script>

<template>
  <div class="flex flex-col gap-6 pb-24">
    <slot name="header" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
