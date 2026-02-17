<script setup lang="ts">
export interface DropdownOption {
  value: string
  label: string
  classes?: string
}

const props = defineProps<{
  options: DropdownOption[]
  modelValue: string | null
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const open = ref(false)

const selectedLabel = computed(() => {
  if (!props.modelValue) return props.placeholder || 'All'
  return props.options.find(o => o.value === props.modelValue)?.label || props.modelValue
})

const selectedClasses = computed(() => {
  if (!props.modelValue) return ''
  return props.options.find(o => o.value === props.modelValue)?.classes || ''
})

function select(value: string | null) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      :class="modelValue
        ? 'border-zinc-600 bg-zinc-800 text-zinc-50'
        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-50'"
      @click="open = !open"
    >
      <span v-if="modelValue && selectedClasses" :class="selectedClasses" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
        {{ selectedLabel }}
      </span>
      <span v-else>{{ selectedLabel }}</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
    >
      <button
        class="flex w-full items-center rounded px-3 py-2 text-left text-xs transition-colors"
        :class="!modelValue ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50'"
        @click="select(null)"
      >
        All
      </button>
      <button
        v-for="opt in options"
        :key="opt.value"
        class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors"
        :class="modelValue === opt.value ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50'"
        @click="select(opt.value)"
      >
        <span v-if="opt.classes" :class="opt.classes" class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {{ opt.label }}
        </span>
        <span v-else>{{ opt.label }}</span>
      </button>
    </div>

    <!-- Backdrop -->
    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
