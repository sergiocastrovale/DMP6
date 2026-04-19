<script setup lang="ts">
import { Wrench } from 'lucide-vue-next'
import type { IssueType } from '~/types/issues'

defineProps<{ count: number; type: IssueType; loading: boolean }>()
const emit = defineEmits<{ fix: [] }>()
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
      class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-zinc-700 bg-zinc-900 px-6 py-3"
    >
      <span class="text-sm text-zinc-300">{{ count }} row{{ count !== 1 ? 's' : '' }} selected</span>
      <button
        :disabled="loading"
        @click="emit('fix')"
        class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        <Wrench :size="15" />
        Fix Selected
      </button>
    </div>
  </Transition>
</template>
