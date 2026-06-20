<script setup lang="ts">
import { AlertTriangle, CircleAlert, ChevronUp, ChevronDown, RefreshCw } from 'lucide-vue-next'
import { timeAgo } from '~/helpers/functions'

interface IssueEvent {
  id: string
  level: 'warn' | 'error'
  message: string
  createdAt: string
}

const props = withDefaults(defineProps<{
  endpoint?: string
  title?: string
  limit?: number
}>(), {
  endpoint: '/api/downloads/monitor-events',
  title: 'Recent issues',
  limit: 50,
})

const events = ref<IssueEvent[]>([])
const open = ref(false)
const loading = ref(false)

const fetchEvents = async () => {
  loading.value = true
  try {
    const data = await $fetch<{ items: IssueEvent[] }>(props.endpoint, { query: { limit: props.limit } })
    events.value = data.items
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
  }
}

onMounted(fetchEvents)
defineExpose({ fetchEvents })
</script>

<template>
  <div v-if="events.length" class="rounded-lg border border-rule">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-1"
      :title="open ? `Collapse ${title.toLowerCase()}` : `Expand ${title.toLowerCase()}`"
      @click="open = !open"
    >
      <span class="flex items-center gap-2 text-sm font-medium text-ink-2">
        <AlertTriangle :size="15" class="text-amber-400" />
        {{ title }}
        <span class="rounded-full bg-bg-2 px-2 py-0.5 text-xs tabular-nums text-ink-3">{{ events.length }}</span>
      </span>
      <span class="flex items-center gap-2">
        <RefreshCw :size="14" title="Refresh issues" :class="['text-ink-4 transition-colors hover:text-ink-2', loading ? 'animate-spin' : '']" @click.stop="fetchEvents" />
        <component :is="open ? ChevronUp : ChevronDown" :size="16" class="text-ink-4" />
      </span>
    </button>
    <ul v-if="open" class="divide-y divide-rule/50 border-t border-rule">
      <li v-for="ev in events" :key="ev.id" class="flex items-start gap-2.5 px-4 py-2 text-sm">
        <component
          :is="ev.level === 'error' ? CircleAlert : AlertTriangle"
          :size="15"
          :class="['mt-0.5 shrink-0', ev.level === 'error' ? 'text-red-400' : 'text-amber-400']"
        />
        <span class="min-w-0 flex-1 break-words text-ink-2">{{ ev.message }}</span>
        <span class="shrink-0 whitespace-nowrap text-xs text-ink-4">{{ timeAgo(ev.createdAt) }}</span>
      </li>
    </ul>
  </div>
</template>
