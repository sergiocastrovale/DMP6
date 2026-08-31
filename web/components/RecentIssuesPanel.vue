<script setup lang="ts">
import { AlertTriangle, Archive, CircleAlert, ChevronUp, ChevronDown, List, RefreshCw } from 'lucide-vue-next'
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

const { archive } = useMonitorEvents()
const toast = useToastStore()
const { hasPerm } = useAuth()

const canEdit = hasPerm('downloads.crud')

const events = ref<IssueEvent[]>([])
const open = ref(false)
const loading = ref(false)
const spinning = ref(false)
const clearing = ref(false)
// Shown under the title: a refetch that returns the same rows is otherwise indistinguishable from
// one that did nothing, which is why the refresh button looked broken.
const lastFetchedAt = ref<string | null>(null)
// Re-renders the relative time without waiting for another fetch, so "updated 4s ago" keeps moving.
const now = ref(Date.now())

let spinTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

const updatedLabel = computed(() => {
  if (!lastFetchedAt.value) {
    return null
  }
  // Referenced so the computed re-evaluates on each tick; timeAgo reads the clock itself.
  void now.value
  return `updated ${timeAgo(lastFetchedAt.value)}`
})

const fetchEvents = async () => {
  loading.value = true
  spinning.value = true
  try {
    const data = await $fetch<{ items: IssueEvent[] }>(props.endpoint, { query: { limit: props.limit } })
    events.value = data.items
    lastFetchedAt.value = new Date().toISOString()
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
    // Keep the spin visible for at least 600ms so fast responses still feel responsive.
    if (spinTimer) { clearTimeout(spinTimer) }
    spinTimer = setTimeout(() => { spinning.value = false }, 600)
  }
}

// Archives exactly what the panel is showing, not every flagged event - the panel is capped at
// `limit`, and a button that silently reached past what you can see would be a different promise.
const clearShown = async () => {
  if (!events.value.length) {
    return
  }
  clearing.value = true
  try {
    const n = await archive(events.value.map(e => e.id))
    toast.success(`Cleared ${n} issue${n === 1 ? '' : 's'}`)
    await fetchEvents()
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Could not clear issues')
  }
  finally { clearing.value = false }
}

onMounted(() => {
  fetchEvents()
  tickTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})

onBeforeUnmount(() => {
  if (spinTimer) { clearTimeout(spinTimer) }
  if (tickTimer) { clearInterval(tickTimer) }
})

defineExpose({ fetchEvents })
</script>

<template>
  <div v-if="events.length" class="rounded-xl border border-stone-100/6">
    <!-- Sibling buttons, not one nested in the other - a <button> inside a <button> is invalid HTML
         and browsers handle the nesting inconsistently. -->
    <div class="flex w-full items-center justify-between gap-2 px-4 py-3">
      <button
        type="button"
        class="flex flex-1 flex-col items-start text-left transition-colors duration-150"
        :aria-expanded="open"
        :title="open ? `Collapse ${title.toLowerCase()}` : `Expand ${title.toLowerCase()}`"
        @click="open = !open"
      >
        <span class="flex items-center gap-2 text-base font-medium text-stone-100/60 hover:text-stone-100">
          <AlertTriangle :size="15" class="text-amber-400" />
          {{ title }}
          <span class="rounded-full bg-stone-800 px-2 py-0.5 text-xs tabular-nums text-stone-100/55">{{ events.length }}</span>
        </span>
        <span v-if="updatedLabel" class="mt-0.5 text-xs text-stone-100/50">{{ updatedLabel }}</span>
      </button>
      <div class="flex items-center gap-2">
        <NuxtLink
          to="/downloads/events"
          aria-label="View all events"
          title="View all events"
          class="rounded-md p-1 text-stone-100/50 transition-colors duration-150 hover:text-stone-100/60"
        >
          <List :size="14" />
        </NuxtLink>
        <button
          v-if="canEdit"
          type="button"
          aria-label="Clear issues"
          title="Move these issues to Archived"
          class="rounded-md p-1 text-stone-100/50 transition-colors duration-150 hover:text-stone-100/60 disabled:opacity-40"
          :disabled="clearing"
          @click="clearShown"
        >
          <Archive :size="14" />
        </button>
        <button type="button" aria-label="Refresh issues" class="rounded-md p-1 text-stone-100/50 transition-colors duration-150 hover:text-stone-100/60" @click="fetchEvents">
          <RefreshCw :size="14" :class="spinning ? 'animate-spin' : ''" />
        </button>
        <button type="button" :aria-label="open ? 'Collapse' : 'Expand'" class="rounded-md p-1 text-stone-100/50 transition-colors duration-150 hover:text-stone-100/60" @click="open = !open">
          <component :is="open ? ChevronUp : ChevronDown" :size="16" />
        </button>
      </div>
    </div>
    <ul v-if="open" class="divide-y divide-stone-100/6 border-t border-stone-100/6">
      <li v-for="ev in events" :key="ev.id" class="flex items-start gap-2.5 px-4 py-2.5 text-base">
        <component
          :is="ev.level === 'error' ? CircleAlert : AlertTriangle"
          :size="15"
          :class="['mt-0.5 shrink-0', ev.level === 'error' ? 'text-danger' : 'text-amber-400']"
        />
        <span class="min-w-0 flex-1 break-words text-stone-100/60">{{ ev.message }}</span>
        <span class="shrink-0 whitespace-nowrap text-xs text-stone-100/50">{{ timeAgo(ev.createdAt) }}</span>
      </li>
    </ul>
  </div>
</template>
