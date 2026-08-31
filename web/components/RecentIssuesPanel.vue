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
const spinning = ref(false)

const fetchEvents = async () => {
  loading.value = true
  spinning.value = true
  try {
    const data = await $fetch<{ items: IssueEvent[] }>(props.endpoint, { query: { limit: props.limit } })
    events.value = data.items
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
    // Keep the spin visible for at least 600ms so fast responses still feel responsive.
    setTimeout(() => { spinning.value = false }, 600)
  }
}

onMounted(fetchEvents)
defineExpose({ fetchEvents })
</script>

<template>
  <div v-if="events.length" class="rounded-xl border border-stone-100/6">
    <!-- Two sibling buttons, not one nested in the other - a <button> inside a <button> is
         invalid HTML and browsers handle the nesting inconsistently. -->
    <div class="flex w-full items-center justify-between gap-2 px-4 py-3">
      <button
        type="button"
        class="flex flex-1 items-center gap-2 text-left text-base font-medium text-stone-100/60 transition-colors duration-150 hover:text-stone-100"
        :aria-expanded="open"
        :title="open ? `Collapse ${title.toLowerCase()}` : `Expand ${title.toLowerCase()}`"
        @click="open = !open"
      >
        <AlertTriangle :size="15" class="text-amber-400" />
        {{ title }}
        <span class="rounded-full bg-stone-800 px-2 py-0.5 text-xs tabular-nums text-stone-100/55">{{ events.length }}</span>
      </button>
      <div class="flex items-center gap-2">
        <button type="button" aria-label="Refresh issues" class="rounded-md p-1 text-stone-100/25 transition-colors duration-150 hover:text-stone-100/60" @click="fetchEvents">
          <RefreshCw :size="14" :class="spinning ? 'animate-spin' : ''" />
        </button>
        <button type="button" :aria-label="open ? 'Collapse' : 'Expand'" class="rounded-md p-1 text-stone-100/25 transition-colors duration-150 hover:text-stone-100/60" @click="open = !open">
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
        <span class="shrink-0 whitespace-nowrap text-xs text-stone-100/25">{{ timeAgo(ev.createdAt) }}</span>
      </li>
    </ul>
  </div>
</template>
