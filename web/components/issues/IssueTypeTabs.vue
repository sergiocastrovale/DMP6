<script setup lang="ts">
import { useIssuesStore } from '~/stores/issues'
import type { IssueType } from '~/types/issues'

defineProps<{ current: IssueType | 'overview' }>()

const issuesStore = useIssuesStore()

const tabs: { key: IssueType | 'overview'; label: string; href: string }[] = [
  { key: 'overview', label: 'Overview', href: '/issues' },
  { key: 'corrupted', label: 'Corrupted TPE2', href: '/issues/corrupted' },
  { key: 'unsplit', label: 'Unsplit Artists', href: '/issues/unsplit' },
  { key: 'orphans', label: 'Orphans', href: '/issues/orphans' },
  { key: 'duplicates', label: 'Duplicates', href: '/issues/duplicates' },
  { key: 'missing', label: 'Missing Metadata', href: '/issues/missing' },
  { key: 'enrichment', label: 'Enrichment', href: '/issues/enrichment' },
]

function getCount(key: IssueType | 'overview'): number | null {
  if (key === 'overview' || !issuesStore.summary) return null
  return issuesStore.summary.counts[key] ?? null
}
</script>

<template>
  <div class="flex gap-1 border-b border-zinc-800 px-4 pt-2 overflow-x-auto">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.href"
      class="flex items-center gap-1.5 whitespace-nowrap rounded-t px-3 py-2 text-sm transition-colors"
      :class="current === tab.key
        ? 'border-b-2 border-blue-500 text-white'
        : 'text-zinc-400 hover:text-zinc-200'"
    >
      {{ tab.label }}
      <span
        v-if="getCount(tab.key) !== null"
        class="rounded-full px-1.5 py-0.5 text-xs font-medium"
        :class="getCount(tab.key)! > 0 ? 'bg-amber-900/50 text-amber-400' : 'bg-zinc-800 text-zinc-500'"
      >
        {{ getCount(tab.key) }}
      </span>
      <span
        v-else-if="tab.key !== 'overview' && issuesStore.summaryLoading"
        class="h-4 w-4 animate-pulse rounded-full bg-zinc-700"
      />
    </NuxtLink>
  </div>
</template>
