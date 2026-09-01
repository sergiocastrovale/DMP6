<script setup lang="ts">
import { cx, segmentGroup } from '~/helpers/ui'

interface RadioOption {
  value: string
  label: string
}

const props = defineProps<{
  options: RadioOption[]
}>()

const model = defineModel<string>({ required: true })

const currentIndex = computed(() => props.options.findIndex(o => o.value === model.value))

const selectByIndex = (index: number) => {
  const count = props.options.length
  const option = props.options[(index + count) % count]
  if (option) {
    model.value = option.value
  }
}

// Roving tabindex + arrow-key movement, per the WAI-ARIA radiogroup pattern: only the checked
// item is in the Tab order, and arrow keys (not Tab) move selection between options.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    selectByIndex(currentIndex.value + 1)
  }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectByIndex(currentIndex.value - 1)
  }
  else if (event.key === 'Home') {
    event.preventDefault()
    selectByIndex(0)
  }
  else if (event.key === 'End') {
    event.preventDefault()
    selectByIndex(props.options.length - 1)
  }
}
</script>

<template>
  <div role="radiogroup" :class="segmentGroup" @keydown="onKeydown">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :class="cx(
        'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150',
        model === option.value ? 'bg-stone-700 text-stone-100' : 'text-stone-100/55 hover:text-stone-100',
      )"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
