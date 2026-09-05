<script setup lang="ts">
import { Loader2, Maximize } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { parseProgress } from '~/helpers/functions'
import { commandLabels } from '~/helpers/constants'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'
import type { ToastSize } from '~/types/ui'

const props = withDefaults(defineProps<{ size?: ToastSize }>(), { size: 'lg' })

const WIDTH: Record<ToastSize, string> = { sm: 'w-72', md: 'w-80', lg: 'w-[26rem]' }
const MAX_LINES: Record<ToastSize, number> = { sm: 1, md: 1, lg: 6 }

const terminal = useTerminalStore()

const progress = computed(() => parseProgress(terminal.lines))

const determinate = computed(() => progress.value != null)

const percent = computed(() => {
  const p = progress.value
  if (!p) {
    return 0
  }
  return Math.min(100, Math.round((p.current / Math.max(1, p.total)) * 100))
})

const label = computed(() => {
  const p = progress.value
  if (p) {
    return `${p.phase === 'index' ? 'Indexing' : 'Syncing'}: ${p.folder || p.artist || ''}`
  }
  return (terminal.currentCommand && commandLabels[terminal.currentCommand]) || 'Running…'
})

const recentLines = computed(() => {
  const lines = terminal.lines
    .filter(l => typeof l === 'string' && !l.startsWith('PROGRESS:'))
    .map(l => (l.startsWith('\r') ? l.slice(1) : l))
  return lines.slice(-MAX_LINES[props.size])
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="terminal.isToastVisible"
      class="fixed bottom-24 right-4 z-50 rounded-lg border border-stone-100/10 bg-stone-900 p-3 shadow-lg"
      :class="WIDTH[size]"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 animate-spin text-amber-400" />
          
          <span class="truncate text-xs font-medium text-stone-100/60">{{ label }}</span>
          
          <span v-if="determinate" class="mr-2 shrink-0 text-2xs text-stone-100/55 tabular-nums">
            ({{ progress!.current }}/{{ progress!.total }})
          </span>
        </div>
        
        <TerminalActions
          toggle-label="Expand"
          :toggle-icon="Maximize"
          @toggle="terminal.expand()"
          @stop="terminal.stopAndClose()"
        />
      </div>

      <div class="mt-2">
        <UiLoadingPanel v-if="determinate" :percent="percent" variant="accent" size="sm" />
        <div v-else class="h-1 w-full overflow-hidden rounded-full bg-stone-800">
          <div class="h-1 w-full animate-pulse rounded-full bg-amber-400" />
        </div>
      </div>

      <div v-if="recentLines.length" class="mt-2 space-y-0.5 font-mono text-2xs leading-4 text-stone-100/55">
        <p v-for="(line, i) in recentLines" :key="i" class="truncate">{{ line }}</p>
      </div>

      <TerminalForceUnlock class="mt-2" />
    </div>
  </Transition>
</template>
