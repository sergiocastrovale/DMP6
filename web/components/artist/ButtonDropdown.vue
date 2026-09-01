<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/types/ui'
import { cx, ICON_STROKE_WIDTH, surface } from '~/helpers/ui'

defineProps<{
  label: string
  options: ButtonDropdownOption[]
  disabled?: boolean
}>()

defineSlots<{ icon(): any }>()

const { open, triggerRef, toggle, close } = useDismissable()

const select = (option: ButtonDropdownOption) => {
  close()
  triggerRef.value?.focus()
  option.action()
}

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    open.value = true
  }
}
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
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
      <ChevronUp v-if="open" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/55" />
      <ChevronDown v-else :size="14" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/55" />
    </button>

    <div
      v-if="open"
      role="menu"
      :class="cx(surface.popover, 'absolute right-0 top-full z-20 mt-1 w-max p-1')"
    >
      <button
        v-for="opt in options"
        :key="opt.label"
        type="button"
        role="menuitem"
        class="flex w-full items-start gap-2.5 rounded px-3 py-2 text-left text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100"
        @click="select(opt)"
      >
        <component :is="opt.icon" v-if="opt.icon" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="mt-0.5 shrink-0 text-stone-100/55" />
        <div class="flex flex-col">
          <span class="text-sm">{{ opt.label }}</span>
          <span v-if="opt.description" class="text-xs text-stone-100/55">{{ opt.description }}</span>
        </div>
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="close" />
  </div>
</template>
