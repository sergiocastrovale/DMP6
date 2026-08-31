<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import { statuses } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, toneFill } from '~/helpers/ui'

defineProps<{
  statusCounts: Record<string, number>
}>()

const activeStatuses = defineModel<Set<string>>('activeStatuses', { required: true })

const toggle = (value: string) => {
  const next = new Set(activeStatuses.value)
  next.has(value) ? next.delete(value) : next.add(value)
  activeStatuses.value = next
}

const helpOpen = ref(false)
const helpButton = ref<HTMLElement | null>(null)

const helpStyle = computed(() => {
  if (!helpButton.value) {
    return {}
  }
  const rect = helpButton.value.getBoundingClientRect()
  return {
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(8, rect.right - 360)}px`,
  }
})
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="text-2xs font-semibold uppercase tracking-wider text-stone-100/50">Status</span>

    <button
      v-for="s in statuses.filter(s => (statusCounts[s.value] ?? 0) > 0)"
      :key="s.value"
      type="button"
      :class="cx(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-2xs font-medium uppercase tracking-wide transition-colors duration-150',
        activeStatuses.has(s.value)
          ? 'border-stone-100/6 bg-stone-800 text-stone-100'
          : 'border-transparent bg-transparent text-stone-100/50 hover:text-stone-100/60',
      )"
      @click="toggle(s.value)"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="toneFill[s.tone]" />
      {{ s.label }} {{ statusCounts[s.value] }}
    </button>

    <div
      class="relative"
      @mouseenter="helpOpen = true"
      @mouseleave="helpOpen = false"
    >
      <button ref="helpButton" type="button" aria-label="Status legend" class="text-stone-100/55 transition-colors duration-150 hover:text-stone-100/60">
        <HelpCircle :size="14" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
      <Teleport to="body">
        <div
          v-if="helpOpen"
          class="fixed z-[600] w-[360px] rounded-lg border border-stone-100/10 bg-stone-900 p-3 text-left shadow-lg"
          :style="helpStyle"
          @mouseenter="helpOpen = true"
          @mouseleave="helpOpen = false"
        >
          <table class="text-xs">
            <tr v-for="s in statuses" :key="s.value" class="border-b border-stone-100/6 last:border-b-0">
              <td class="whitespace-nowrap px-2 py-3">
                <span class="inline-flex items-center gap-2">
                  <span class="size-1.5 shrink-0 rounded-full" :class="toneFill[s.tone]" />
                  <span class="font-medium text-stone-100">{{ s.label }}</span>
                </span>
              </td>
              <td class="py-1 text-stone-100/60">{{ s.description }}</td>
            </tr>
          </table>
        </div>
      </Teleport>
    </div>
  </div>
</template>
