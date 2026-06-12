<script setup lang="ts">
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  subtitle?: string
}>(), {
  maxWidth: 'lg',
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
    case 'xl':
      return 'max-w-3xl'
    case '2xl':
      return 'max-w-4xl'
    default: 
      return 'max-w-lg'
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-3000 flex items-center justify-center bg-black/60 p-4"
      @click.self="close"
    >
      <div :class="maxWidthClass" class="w-full max-h-[80vh] flex flex-col rounded-xl border border-rule bg-bg-1 shadow-2xl">
        <div class="border-b border-rule px-7 py-5">
          <div class="flex items-center justify-between">
            <h2 class="block w-full text-lg font-semibold text-ink">{{ title }}</h2>
            <UiButton variant="ghost" icon-only :icon="X" aria-label="Close" @click="close" />
          </div>
          <h3 v-if="subtitle" class="text-sm text-ink-2">{{ subtitle }}</h3>
        </div>
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
