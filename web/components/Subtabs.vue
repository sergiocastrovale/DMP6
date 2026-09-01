<script setup lang="ts">
import type { SubtabItem } from '~/types/ui'
import { cx } from '~/helpers/ui'

const props = defineProps<{
  tabs: SubtabItem[]
}>()

const active = defineModel<string>()
const listRef = ref<HTMLElement>()

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
</script>

<template>
  <div ref="listRef" role="tablist" class="flex gap-1 border-b border-stone-100/6" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="active === tab.key"
      :tabindex="active === tab.key ? 0 : -1"
      :class="cx(
        'px-4 py-2 text-sm font-medium transition-colors duration-150',
        active === tab.key ? `border-b-2 ${tab.activeColor || 'border-amber-400'} text-stone-100` : 'text-stone-100/55 hover:text-stone-100/60',
      )"
      @click="active = tab.key"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined && tab.count > 0" class="ml-1.5 rounded-full bg-stone-800 px-1.5 py-0.5 text-xs">
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
