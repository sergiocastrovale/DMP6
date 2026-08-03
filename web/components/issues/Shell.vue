<script setup lang="ts">
import { useIssuesStore } from '~/stores/issues'

const issuesStore = useIssuesStore()

onMounted(() => {
  issuesStore.fetchHistoryCounts()
})

const historyTotal = computed(() =>
  (issuesStore.historyCounts.corrupted ?? 0) +
  (issuesStore.historyCounts.missing ?? 0)
)

const breadcrumbRoot = { label: 'Issues', to: '/issues' }
const breadcrumbLabels: Record<string, string> = {
  corrupted: 'Corrupted TPE2',
  orphans: 'Orphans',
  duplicates: 'Duplicates',
  missing: 'Missing Metadata',
  enrichment: 'Enrichment',
  history: 'Fix History',
}

const tabs = computed(() => [
  { key: 'overview', label: 'Overview', href: '/issues' },
  { key: 'corrupted', label: 'Corrupted TPE2', href: '/issues/corrupted', count: issuesStore.summary?.counts.corrupted, countHighlight: true },
  { key: 'orphans', label: 'Orphans', href: '/issues/orphans', count: issuesStore.summary?.counts.orphans, countHighlight: true },
  { key: 'duplicates', label: 'Duplicates', href: '/issues/duplicates', count: issuesStore.summary?.counts.duplicates, countHighlight: true },
  { key: 'missing', label: 'Missing Metadata', href: '/issues/missing', count: issuesStore.summary?.counts.missing, countHighlight: true },
  { key: 'enrichment', label: 'Enrichment', href: '/issues/enrichment', count: issuesStore.summary?.counts.enrichment, countHighlight: true },
  { key: 'history', label: 'History', href: '/issues/history', count: historyTotal.value > 0 ? historyTotal.value : undefined },
])
</script>

<template>
  <TabShell :breadcrumb-root="breadcrumbRoot" :breadcrumb-labels="breadcrumbLabels" :tabs="tabs">
    <template #header>
      <slot name="header" />
    </template>
    <slot />
  </TabShell>
</template>
