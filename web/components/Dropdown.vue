<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

interface DropdownOption {
  value: string
  label: string
  classes?: string
}

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  modelValue: string | null
  placeholder?: string
  icon?: Component
  // Set false for an always-one-of-these-options control (e.g. sort order) that has no "show
  // everything" state - hides the leading "All" entry rather than forcing every consumer to
  // filter it out of `options` itself.
  allowClear?: boolean
}>(), {
  allowClear: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const open = ref(false)
const triggerRef = ref<HTMLElement>()

const selectedOption = computed(() => props.options.find(o => o.value === props.modelValue))
const selectedLabel = computed(() => selectedOption.value?.label ?? props.placeholder ?? 'All')

const select = (value: string | null) => {
  emit('update:modelValue', value)
  open.value = false
  triggerRef.value?.focus()
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
      aria-haspopup="listbox"
      :aria-expanded="open"
      :class="cx(
        'flex items-center gap-1.5 rounded-lg border border-stone-100/10 px-3 py-1.5 text-xs transition-colors duration-150',
        modelValue ? 'bg-stone-800 text-stone-100' : 'bg-stone-900 text-stone-100/60 hover:text-stone-100',
      )"
      @click="open = !open"
      @keydown="onTriggerKeydown"
    >
      <component :is="icon" v-if="icon" :size="12" :stroke-width="ICON_STROKE_WIDTH" />
      <span v-if="modelValue && selectedOption?.classes" :class="selectedOption.classes" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
        {{ selectedLabel }}
      </span>
      <span v-else>{{ selectedLabel }}</span>
      <ChevronDown :size="12" :stroke-width="ICON_STROKE_WIDTH" />
    </button>

    <div
      v-if="open"
      role="listbox"
      class="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-stone-100/10 bg-stone-900 p-1 shadow-lg"
    >
      <button
        v-if="allowClear"
        type="button"
        role="option"
        :aria-selected="!modelValue"
        :class="cx(
          'flex w-full items-center rounded px-3 py-2 text-left text-xs transition-colors duration-150',
          !modelValue ? 'bg-stone-800 text-stone-100' : 'text-stone-100/60 hover:bg-stone-800 hover:text-stone-100',
        )"
        @click="select(null)"
      >
        All
      </button>
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        role="option"
        :aria-selected="modelValue === opt.value"
        :class="cx(
          'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors duration-150',
          modelValue === opt.value ? 'bg-stone-800 text-stone-100' : 'text-stone-100/60 hover:bg-stone-800 hover:text-stone-100',
        )"
        @click="select(opt.value)"
      >
        <span v-if="opt.classes" :class="opt.classes" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {{ opt.label }}
        </span>
        <span v-else>{{ opt.label }}</span>
      </button>
    </div>

    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
