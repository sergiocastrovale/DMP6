<script setup lang="ts">
import { ChevronRight, ScanSearch } from 'lucide-vue-next'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { IssueType } from '~/types/issues'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Issues' })

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const historyCount = ref(0)

onMounted(() => {
  issuesStore.fetchSummary()
  fetchHistoryCount()
})

watch(() => terminal.exitCode, (code) => {
  if (code === 0) {
    issuesStore.fetchSummary()
  }
})

function runAudit() {
  terminal.run('./audit', [], 'audit')
  terminal.open()
}

async function fetchHistoryCount() {
  const res = await $fetch<{ count: number }>('/api/issues/history')
  historyCount.value = res.count
}

const typeCards: { key: IssueType; label: string; description: string }[] = [
  { key: 'corrupted', label: 'Corrupted TPE2', description: 'Track numbers, paths, or years leaked into albumArtist tags' },
  { key: 'orphans', label: 'Orphan Artists', description: 'Artists with no releases, no tracks, or garbage phantom names' },
  { key: 'duplicates', label: 'Duplicate Artists', description: 'Artists with the same normalized name that should be merged' },
  { key: 'missing', label: 'Missing Metadata', description: 'Tracks with null or empty core metadata fields' },
  { key: 'enrichment', label: 'Enrichment Gaps', description: 'Releases missing BPM, mood, AcousticID, or other enrichment data' },
  { key: 'duplicate-release', label: 'Duplicate Releases', description: 'Local release pairs sharing one MusicBrainz release ID with matching title, track count, and duration - likely redundant folder copies' },
  { key: 'mismatched-release-id', label: 'Mismatched Release ID', description: 'Local release pairs sharing one MusicBrainz release ID despite different titles - a sync-matcher linking bug' },
]

function formatRelative(date: string): string {
  const ms = Date.now() - new Date(date).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) { return 'just now' }
  if (min < 60) { return `${min}m ago` }
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}
</script>

<template>
  <IssuesShell>
    <template #header>
      <PageTitle
        text="Metadata Issues"
        :subtext="issuesStore.summary?.lastAudit
          ? `Last audit: ${formatRelative(issuesStore.summary.lastAudit.startedAt)}`
          : (!issuesStore.summaryLoading ? 'No audit has been run yet' : undefined)"
      >
        <UiButton :icon="ScanSearch" :loading="terminal.isRunning" @click="runAudit">
          Run Audit
        </UiButton>
      </PageTitle>
    </template>

    <NuxtLink
      v-if="historyCount > 0"
      to="/issues/history"
      class="flex items-center justify-between rounded-xl border border-stone-100/6 bg-stone-900/50 px-4 py-3 transition-colors duration-150 hover:border-stone-100/10"
    >
      <span class="text-base text-stone-100/60">
        {{ historyCount }} undo record{{ historyCount !== 1 ? 's' : '' }} stored
      </span>
      <ChevronRight :size="16" class="text-stone-100/20" />
    </NuxtLink>

    <UiEmptyState v-if="!issuesStore.summary && !issuesStore.summaryLoading" message="Run an audit to detect metadata issues" />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="card in typeCards"
        :key="card.key"
        :to="`/issues/${card.key}`"
        class="rounded-xl border border-stone-100/6 bg-stone-900 p-4 transition-colors duration-150 hover:border-stone-100/10"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="font-medium text-stone-100">{{ card.label }}</p>
            <p class="mt-1 text-sm text-stone-100/55">{{ card.description }}</p>
          </div>
          <UiBadge
            v-if="issuesStore.summary"
            size="md"
            class="ml-3 shrink-0"
            :tone="(issuesStore.summary.counts[card.key] ?? 0) > 0 ? 'accent' : 'muted'"
          >
            {{ issuesStore.summary.counts[card.key] ?? 0 }}
          </UiBadge>
          <span v-else-if="issuesStore.summaryLoading" class="ml-3 h-7 w-10 animate-pulse rounded-full bg-stone-800" />
        </div>
      </NuxtLink>
    </div>
  </IssuesShell>
</template>
