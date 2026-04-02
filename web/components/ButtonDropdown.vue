<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'

export interface ButtonDropdownOption {
  label: string
  description?: string
  action: () => void
}

defineProps<{
  label: string
  options: ButtonDropdownOption[]
  disabled?: boolean
}>()

defineSlots<{ icon(): any }>()

const open = ref(false)
const buttonRef = ref<HTMLElement>()

function select(option: ButtonDropdownOption) {
  open.value = false
  option.action()
}
</script>

<template>
  <div class="relative">
    <button
      ref="buttonRef"
      :disabled="disabled"
      class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50"
      @click="open = !open"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
      <ChevronUp v-if="open" :size="14" class="text-zinc-500" />
      <ChevronDown v-else :size="14" class="text-zinc-500" />
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full z-20 mt-1 w-max rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
    >
      <button
        v-for="opt in options"
        :key="opt.label"
        class="flex w-full flex-col rounded px-3 py-2 text-left transition-colors text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
        @click="select(opt)"
      >
        <span class="text-sm">{{ opt.label }}</span>
        <span v-if="opt.description" class="text-xs text-zinc-500">{{ opt.description }}</span>
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
