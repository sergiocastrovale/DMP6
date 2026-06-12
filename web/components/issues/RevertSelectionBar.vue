<script setup lang="ts">
import { Undo2 } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ revert: [mode: 'undo' | 'undo-resolved'] }>()
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
      v-if="count > 0"
      class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-rule bg-bg-1 px-6 py-3 transition-all duration-300 lg:left-56"
      :class="{ 'lg:right-[500px]': terminal.isOpen }"
    >
      <span class="text-sm text-ink-2">{{ count }} row{{ count !== 1 ? 's' : '' }} selected</span>
      <div class="flex items-center gap-3">
        <UiButton :icon="Undo2" :loading="loading" @click="emit('revert', 'undo')">
          Undo
        </UiButton>
        <UiButton variant="secondary" :icon="Undo2" :loading="loading" @click="emit('revert', 'undo-resolved')">
          Undo (keep resolved)
        </UiButton>
      </div>
    </div>
  </Transition>
</template>
