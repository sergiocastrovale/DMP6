<script setup lang="ts">
import { ChevronDown, HelpCircle } from 'lucide-vue-next'
import { statuses } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, surface, toneFill } from '~/helpers/ui'

const props = defineProps<{
  statusCounts: Record<string, number>
}>()

const activeStatuses = defineModel<Set<string>>('activeStatuses', { required: true })

const visibleStatuses = computed(() => statuses.filter(s => (props.statusCounts[s.value] ?? 0) > 0))

const toggle = (value: string) => {
  const next = new Set(activeStatuses.value)
  next.has(value) ? next.delete(value) : next.add(value)
  activeStatuses.value = next
}

const { open, triggerRef, toggle: toggleDropdown, close } = useDismissable()

const dropdownLabel = computed(() => {
  if (activeStatuses.value.size === 0) {
    return 'All statuses'
  }
  if (activeStatuses.value.size === 1) {
    return visibleStatuses.value.find(s => activeStatuses.value.has(s.value))?.label ?? 'All statuses'
  }
  return `${activeStatuses.value.size} statuses`
})

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
    <button
      v-for="s in visibleStatuses"
      :key="s.value"
      type="button"
      :class="cx(
        'hidden items-center gap-1.5 rounded-md border px-2.5 py-1 text-2xs font-medium uppercase tracking-wide transition-colors duration-150 lg:flex',
        (activeStatuses.size === 0 || activeStatuses.has(s.value))
          ? 'border-stone-100/6 bg-stone-800 text-stone-100'
          : 'border-transparent bg-transparent text-stone-100/50 hover:text-stone-100/60',
      )"
      @click="toggle(s.value)"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="toneFill[s.tone]" />
      {{ s.label }} {{ statusCounts[s.value] }}
    </button>

    <div class="relative lg:hidden">
      <button
        ref="triggerRef"
        type="button"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :class="cx(
          'flex items-center gap-1.5 rounded-lg border border-stone-100/10 px-3 py-1.5 text-xs transition-colors duration-150',
          activeStatuses.size > 0 ? 'bg-stone-800 text-stone-100' : 'bg-stone-900 text-stone-100/60 hover:text-stone-100',
        )"
        @click="toggleDropdown"
      >
        <span>{{ dropdownLabel }}</span>
        <ChevronDown :size="12" :stroke-width="ICON_STROKE_WIDTH" />
      </button>

      <div
        v-if="open"
        role="listbox"
        :class="cx(surface.popover, 'absolute left-0 top-full z-20 mt-1 min-w-[200px] p-1')"
      >
        <button
          v-for="s in visibleStatuses"
          :key="s.value"
          type="button"
          role="option"
          :aria-selected="activeStatuses.size === 0 || activeStatuses.has(s.value)"
          :class="cx(
            'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors duration-150',
            (activeStatuses.size === 0 || activeStatuses.has(s.value))
              ? 'bg-stone-800 text-stone-100'
              : 'text-stone-100/60 hover:bg-stone-800 hover:text-stone-100',
          )"
          @click="toggle(s.value)"
        >
          <span class="size-1.5 shrink-0 rounded-full" :class="toneFill[s.tone]" />
          <span class="flex-1">{{ s.label }}</span>
          <span class="text-stone-100/50">{{ statusCounts[s.value] }}</span>
        </button>
      </div>

      <div v-if="open" class="fixed inset-0 z-10" @click="close" />
    </div>

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
