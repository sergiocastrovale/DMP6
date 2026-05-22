<script setup lang="ts">
import { Activity, ChevronRight, Loader2 } from 'lucide-vue-next'
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
  { key: 'unsplit', label: 'Unsplit Artists', description: 'Compound artist names that should be split into individual artists' },
  { key: 'orphans', label: 'Orphan Artists', description: 'Artists with no releases, no tracks, or garbage phantom names' },
  { key: 'duplicates', label: 'Duplicate Artists', description: 'Artists with the same normalized name that should be merged' },
  { key: 'missing', label: 'Missing Metadata', description: 'Tracks with null or empty core metadata fields' },
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
        :icon="Activity"
        text="Metadata Issues"
        :subtext="issuesStore.summary?.lastAudit
          ? `Last audit: ${formatRelative(issuesStore.summary.lastAudit.startedAt)}`
          : (!issuesStore.summaryLoading ? 'No audit has been run yet' : undefined)"
      >
        <button
          :disabled="terminal.isRunning"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          @click="runAudit"
        >
          <Loader2 v-if="terminal.isRunning" :size="15" class="animate-spin" />
          <Activity v-else :size="15" />
          Run Audit
        </button>
      </PageTitle>
    </template>

    <NuxtLink
      v-if="historyCount > 0"
      to="/issues/history"
      class="flex items-center justify-between rounded-lg border border-rule bg-bg-1/50 px-4 py-3 transition-colors hover:border-rule"
    >
      <span class="text-sm text-ink-2">
        {{ historyCount }} undo record{{ historyCount !== 1 ? 's' : '' }} stored
      </span>
      <ChevronRight :size="16" class="text-ink-4" />
    </NuxtLink>

    <div v-if="!issuesStore.summary && !issuesStore.summaryLoading" class="py-20 text-center text-ink0">
      Run an audit to detect metadata issues
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="card in typeCards"
        :key="card.key"
        :to="`/issues/${card.key}`"
        class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule"
      >
        <div class="flex items-start justify-between">
          <div>
            <p class="font-medium text-white">{{ card.label }}</p>
            <p class="mt-1 text-xs text-ink0">{{ card.description }}</p>
          </div>
          <span
            v-if="issuesStore.summary"
            class="ml-3 shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold"
            :class="(issuesStore.summary.counts[card.key] ?? 0) > 0 ? 'bg-accent-soft text-accent' : 'bg-bg-2 text-ink0'"
          >
            {{ issuesStore.summary.counts[card.key] ?? 0 }}
          </span>
          <span v-else-if="issuesStore.summaryLoading" class="ml-3 h-7 w-10 animate-pulse rounded-full bg-bg-2" />
        </div>
      </NuxtLink>
    </div>
  </IssuesShell>
</template>
