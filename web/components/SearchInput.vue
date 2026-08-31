<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

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
  }
  else {
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
  <div :class="cx('relative', wrapperClass, showSubmit ? 'flex items-center gap-2' : '')">
    <div
      :class="cx(
        'flex items-center gap-[9px] rounded-md border border-stone-100/10 bg-stone-900 px-3 transition-colors duration-150 focus-within:border-amber-400/40',
        sizeClass,
        showSubmit ? 'flex-1' : 'w-full',
      )"
    >
      <Search :size="14" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 text-stone-100/55" />
      <input
        :value="inputValue"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        class="w-full bg-transparent text-base text-stone-100 outline-0 placeholder:text-stone-100/50"
        @input="handleInput"
        @keydown="handleKeydown"
        @focus="emit('focus', $event)"
        @blur="emit('blur', $event)"
      >
      <button
        v-if="clearable && inputValue"
        type="button"
        aria-label="Clear search"
        class="shrink-0 text-stone-100/55 transition-colors duration-150 hover:text-stone-100"
        @click="clear"
      >
        <X :size="14" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
    </div>

    <button
      v-if="showSubmit"
      type="button"
      :class="cx(
        'shrink-0 rounded-md border border-stone-100/10 bg-stone-800 px-3 text-sm text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 hover:text-stone-100',
        sizeClass,
      )"
      :disabled="disabled"
      @click="emit('submit')"
    >
      Search
    </button>

    <slot name="results" />
  </div>
</template>
