<script setup lang="ts">
import type { TabItem } from '~/types/ui'
import { cx } from '~/helpers/ui'

defineProps<{
  tabs: TabItem[]
}>()

const activeTab = defineModel<string>()
const route = useRoute()
const listRef = ref<HTMLElement>()

// WAI-ARIA tablist "manual activation" pattern: arrow keys move focus (roving tabindex) among
// the tabs, independent of which one is selected. Works the same for the route-linked tabs and
// the model-driven ones since both carry role="tab" + a real/virtual selected state.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
    return
  }
  const container = listRef.value
  if (!container) {
    return
  }
  const items = [...container.querySelectorAll<HTMLElement>('[role="tab"]')]
  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  if (currentIndex === -1 || items.length === 0) {
    return
  }
  event.preventDefault()
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % items.length
  }
  else if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + items.length) % items.length
  }
  else if (event.key === 'Home') {
    nextIndex = 0
  }
  else if (event.key === 'End') {
    nextIndex = items.length - 1
  }
  items[nextIndex]?.focus()
}

const countPillClass = (tab: TabItem) => cx(
  'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-2xs font-semibold',
  tab.countHighlight && (tab.count ?? 0) > 0 ? 'bg-amber-400/20 text-amber-400' : 'bg-stone-800 text-stone-100/55',
)

const tabClass = (selected: boolean) => cx(
  '-mb-px flex items-center gap-2 px-3 py-2 text-base font-medium transition-colors duration-150',
  selected ? 'border-b-2 border-amber-400 text-stone-100' : 'border-b-2 border-transparent text-stone-100/55 hover:text-stone-100',
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 border-b border-stone-100/6">
    <slot name="prepend" />
    <div ref="listRef" role="tablist" class="flex flex-wrap items-center gap-1" @keydown="onKeydown">
      <template v-for="tab in tabs" :key="tab.key">
        <NuxtLink
          v-if="tab.href"
          :to="tab.href"
          role="tab"
          :aria-selected="route.path === tab.href"
          :tabindex="route.path === tab.href ? 0 : -1"
          :class="tabClass(route.path === tab.href)"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count !== undefined" :class="countPillClass(tab)">{{ tab.count }}</span>
        </NuxtLink>
        <button
          v-else
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :class="tabClass(activeTab === tab.key)"
          @click="activeTab = tab.key"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.count !== undefined" :class="countPillClass(tab)">{{ tab.count }}</span>
        </button>
      </template>
    </div>
    <div class="flex-1" />
    <slot name="append" />
  </div>
</template>
