<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  maxWidth?: 'sm' | 'md' | 'lg'
}>(), {
  maxWidth: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function close() {
  emit('update:modelValue', false)
}

const maxWidthClass = computed(() => {
  switch (props.maxWidth) {
    case 'sm':
      return 'max-w-sm'
    case 'lg': 
      return 'max-w-2xl'
    default: 
      return 'max-w-md'
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="close"
    >
      <div :class="maxWidthClass" class="w-full max-h-[90vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 class="text-lg font-semibold text-zinc-50">{{ title }}</h2>
          <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>        
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
