<script setup lang="ts">
import { FolderInput } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const props = defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ merge: [] }>()
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
      <UiButton :icon="FolderInput" :loading="props.loading" @click="emit('merge')">
        Merge Selected
      </UiButton>
    </div>
  </Transition>
</template>
