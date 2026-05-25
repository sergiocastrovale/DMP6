<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import { statuses } from '~/helpers/constants'

defineProps<{
  statusCounts: Record<string, number>
}>()

const activeStatuses = defineModel<Set<string>>('activeStatuses', { required: true })

const dotColors: Record<string, string> = {
  COMPLETE: 'bg-emerald-400',
  EXTRA_TRACKS: 'bg-blue-400',
  MISSING_TRACKS: 'bg-orange-400',
  INCOMPLETE: 'bg-accent',
  MISSING: 'bg-red-400',
  UNKNOWN: 'bg-ink-2',
  UNMATCHED: 'bg-accent',
}

const toggle = (value: string) => {
  const next = new Set(activeStatuses.value)
  next.has(value) ? next.delete(value) : next.add(value)
  activeStatuses.value = next
}

</script>

<template>
  <div class="flex items-center gap-2">
    <span class="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Status</span>

    <button
      v-for="s in statuses.filter(s => (statusCounts[s.value] ?? 0) > 0)"
      :key="s.value"
      type="button"
      class="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors"
      :class="activeStatuses.has(s.value)
        ? 'border-rule bg-bg-2 text-ink'
        : 'border-transparent bg-transparent text-ink-4 hover:text-ink-2'"
      @click="toggle(s.value)"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="dotColors[s.value]" />
      {{ s.label }} {{ statusCounts[s.value] }}
    </button>

    <Popover trigger="hover">
      <template #trigger>
        <button class="text-ink0 transition-colors hover:text-ink-2">
          <HelpCircle :size="14" />
        </button>
      </template>
      <template #content>
        <div class="absolute right-0 top-full z-20 mt-1 w-[360px] rounded-lg border border-rule bg-bg-1 p-3 text-left shadow-xl">
          <table class="text-xs">
            <tr v-for="s in statuses" :key="s.value" class="border-b border-rule last:border-b-0">
              <td class="whitespace-nowrap py-3 px-2">
                <span class="inline-flex items-center gap-2">
                  <span class="size-1.5 shrink-0 rounded-full" :class="dotColors[s.value]" />
                  <span class="font-medium text-ink">{{ s.label }}</span>
                </span>
              </td>
              <td class="py-1 text-ink-2">{{ s.description }}</td>
            </tr>
          </table>
        </div>
      </template>
    </Popover>
  </div>
</template>
