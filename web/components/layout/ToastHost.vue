<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-vue-next'
import type { ToastKind } from '~/stores/toast'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const toast = useToastStore()
const { toasts } = storeToRefs(toast)

const iconFor = (kind: ToastKind) =>
  kind === 'error' ? AlertTriangle : kind === 'success' ? CheckCircle2 : Info

const toneFor = (kind: ToastKind) =>
  kind === 'error' ? 'text-danger' : kind === 'success' ? 'text-success' : 'text-stone-100/60'
</script>

<template>
  <div aria-live="polite" role="status" class="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-4 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-x-4 opacity-0"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="flex items-start gap-2 rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2.5 shadow-lg"
      >
        <component :is="iconFor(t.kind)" :size="16" :stroke-width="ICON_STROKE_WIDTH" :class="['mt-0.5 shrink-0', toneFor(t.kind)]" />
        <p class="flex-1 text-sm text-stone-100/60 break-words">{{ t.message }}</p>
        <button
          type="button"
          aria-label="Dismiss"
          class="shrink-0 text-stone-100/40 transition-colors duration-150 hover:text-stone-100"
          @click="toast.dismiss(t.id)"
        >
          <X :size="14" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
