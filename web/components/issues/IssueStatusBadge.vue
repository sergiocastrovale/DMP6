<script setup lang="ts">
import type { IssueStatus } from '~/types/issues'

const props = defineProps<{ status: IssueStatus }>()

const colors: Record<IssueStatus, string> = {
  DETECTED: 'bg-bg-3 text-ink-2',
  PENDING: 'bg-accent-soft text-accent',
  PENDING_REVERT: 'bg-purple-900/40 text-purple-400',
  RESOLVED: 'bg-green-900/40 text-green-400',
  FAILED: 'bg-red-900/40 text-red-400',
}
</script>

<template>
  <span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" :class="colors[status]">
    {{ status.toLowerCase() }}
  </span>
</template>
