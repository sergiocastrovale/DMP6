<script setup lang="ts">
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/types/ui'

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
      class="flex items-center gap-2 rounded-lg border border-rule bg-bg-1 px-3 py-2 text-sm text-ink-2 transition-colors hover:border-ink-4 hover:bg-bg-2 disabled:pointer-events-none disabled:opacity-50"
      @click="open = !open"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
      <ChevronUp v-if="open" :size="14" class="text-ink-3" />
      <ChevronDown v-else :size="14" class="text-ink-3" />
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-full z-20 mt-1 w-max rounded-lg border border-rule bg-bg-1 p-1 shadow-xl"
    >
      <button
        v-for="opt in options"
        :key="opt.label"
        class="flex w-full items-start gap-2.5 rounded px-3 py-2 text-left transition-colors text-ink-2 hover:bg-bg-2 hover:text-ink"
        @click="select(opt)"
      >
        <component :is="opt.icon" v-if="opt.icon" :size="14" class="mt-0.5 shrink-0 text-ink-3" />
        <div class="flex flex-col">
          <span class="text-sm">{{ opt.label }}</span>
          <span v-if="opt.description" class="text-xs text-ink-3">{{ opt.description }}</span>
        </div>
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
