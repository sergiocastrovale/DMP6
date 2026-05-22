<script setup lang="ts">
import { Trash2, Undo2 } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ clear: []; undo: [] }>()
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
        <button
          :disabled="loading"
          class="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          @click="emit('clear')"
        >
          <Trash2 :size="15" />
          Clear selected
        </button>
        <button
          :disabled="loading"
          class="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent disabled:opacity-50"
          @click="emit('undo')"
        >
          <Undo2 :size="15" />
          Undo selected
        </button>
      </div>
    </div>
  </Transition>
</template>
