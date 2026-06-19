<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-vue-next'
import type { ToastKind } from '~/stores/toast'

const toast = useToastStore()
const { toasts } = storeToRefs(toast)

const iconFor = (kind: ToastKind) =>
  kind === 'error' ? AlertTriangle : kind === 'success' ? CheckCircle2 : Info

const accentFor = (kind: ToastKind) =>
  kind === 'error' ? 'text-red-400' : kind === 'success' ? 'text-emerald-400' : 'text-ink-2'
</script>

<template>
  <div class="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-4 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-x-4 opacity-0"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="flex items-start gap-2 rounded-lg border border-rule bg-bg-2 px-3 py-2.5 shadow-lg"
      >
        <component :is="iconFor(t.kind)" :size="16" :class="['mt-0.5 shrink-0', accentFor(t.kind)]" />
        <p class="flex-1 text-sm text-ink-2 break-words">{{ t.message }}</p>
        <button
          class="shrink-0 text-ink-3 transition-colors hover:text-ink"
          @click="toast.dismiss(t.id)"
        >
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
