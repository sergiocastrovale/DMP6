<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/types/ui'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

defineProps<{
  label: string
  options: ButtonDropdownOption[]
  disabled?: boolean
}>()

defineSlots<{ icon(): any }>()

const open = ref(false)
const triggerRef = ref<HTMLElement>()

const select = (option: ButtonDropdownOption) => {
  open.value = false
  triggerRef.value?.focus()
  option.action()
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    open.value = true
  }
}

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    open.value = false
    triggerRef.value?.focus()
  }
}

// document is undefined during SSR - open always starts false, so there is nothing to attach on
// the very first (server) render anyway. A plain (non-immediate) watch only ever fires in
// response to a later, client-side change, which is exactly what this needs.
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', onDocumentKeydown)
  }
  else {
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div class="relative">
    <button
      ref="triggerRef"
      type="button"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      class="flex items-center gap-2 rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 text-sm text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100 disabled:pointer-events-none disabled:opacity-40"
      @click="open = !open"
      @keydown="onTriggerKeydown"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
      <ChevronUp v-if="open" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/40" />
      <ChevronDown v-else :size="14" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/40" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-full z-20 mt-1 w-max rounded-lg border border-stone-100/10 bg-stone-900 p-1 shadow-lg"
    >
      <button
        v-for="opt in options"
        :key="opt.label"
        type="button"
        role="menuitem"
        class="flex w-full items-start gap-2.5 rounded px-3 py-2 text-left text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100"
        @click="select(opt)"
      >
        <component :is="opt.icon" v-if="opt.icon" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="mt-0.5 shrink-0 text-stone-100/40" />
        <div class="flex flex-col">
          <span class="text-sm">{{ opt.label }}</span>
          <span v-if="opt.description" class="text-xs text-stone-100/40">{{ opt.description }}</span>
        </div>
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
