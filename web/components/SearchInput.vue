<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  showSubmit?: boolean
  size?: 'sm' | 'md'
  debounce?: number
  disabled?: boolean
  clearable?: boolean
  wrapperClass?: string
}>(), {
  placeholder: 'Search...',
  showSubmit: false,
  size: 'sm',
  debounce: 300,
  disabled: false,
  clearable: false,
  wrapperClass: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'submit': []
  'clear': []
  'focus': [event: FocusEvent]
  'blur': [event: FocusEvent]
}>()

const slots = defineSlots<{
  results?: () => any
}>()

let debounceTimer: ReturnType<typeof setTimeout> | null = null
const inputValue = ref(props.modelValue)

watch(() => props.modelValue, (val) => {
  inputValue.value = val
})

const sizeClass = computed(() => props.size === 'md' ? 'h-9' : 'h-8')

const handleInput = (event: Event) => {
  const val = (event.target as HTMLInputElement).value
  inputValue.value = val
  if (debounceTimer) { clearTimeout(debounceTimer) }
  if (props.debounce === 0) {
    emit('update:modelValue', val)
  } else {
    debounceTimer = setTimeout(() => {
      emit('update:modelValue', val)
    }, props.debounce)
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    if (debounceTimer) { clearTimeout(debounceTimer) }
    emit('update:modelValue', inputValue.value)
    emit('submit')
  }
}

const clear = () => {
  inputValue.value = ''
  emit('update:modelValue', '')
  emit('clear')
}

onUnmounted(() => {
  if (debounceTimer) { clearTimeout(debounceTimer) }
})
</script>

<template>
  <div :class="['relative', wrapperClass, showSubmit ? 'flex items-center gap-2' : '']">
    <div
      :class="[
        'flex items-center gap-1.5 rounded-lg border border-rule bg-bg-1 px-3',
        sizeClass,
        showSubmit ? 'flex-1' : 'w-full',
      ]"
    >
      <Search :size="14" class="shrink-0 text-ink-2" />
      <input
        :value="inputValue"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-2"
        @input="handleInput"
        @keydown="handleKeydown"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      >
      <button
        v-if="clearable && inputValue"
        class="shrink-0 text-ink-2 transition-colors hover:text-ink"
        @click="clear"
      >
        <X :size="14" />
      </button>
    </div>

    <button
      v-if="showSubmit"
      class="shrink-0 rounded-lg border border-rule bg-bg-2 px-3 text-sm text-ink-2 transition-colors hover:bg-bg-3"
      :class="sizeClass"
      :disabled="disabled"
      @click="emit('submit')"
    >
      Search
    </button>

    <slot name="results" />
  </div>
</template>
