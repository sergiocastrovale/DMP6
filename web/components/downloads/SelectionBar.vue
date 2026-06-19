<script setup lang="ts">
import type { Component } from 'vue'
import { useTerminalStore } from '~/stores/terminal'

interface BarAction {
  key: string
  label: string
  icon?: Component
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

const props = withDefaults(defineProps<{
  count: number
  loading?: boolean
  actions: BarAction[]
}>(), {
  loading: false,
})

const emit = defineEmits<{ action: [key: string] }>()
const terminal = useTerminalStore()
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="props.count > 0"
      class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-rule bg-bg-1 px-6 py-3 transition-all duration-300 lg:left-56"
      :class="{ 'lg:right-[500px]': terminal.isOpen }"
    >
      <span class="text-sm text-ink-2">{{ props.count }} row{{ props.count !== 1 ? 's' : '' }} selected</span>
      <div class="flex items-center gap-2">
        <UiButton
          v-for="action in props.actions"
          :key="action.key"
          :icon="action.icon"
          :variant="action.variant ?? 'primary'"
          :loading="props.loading"
          :title="action.label"
          @click="emit('action', action.key)"
        >
          {{ action.label }}
        </UiButton>
      </div>
    </div>
  </Transition>
</template>
