<script setup lang="ts">
import { Loader2, LockOpen } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { parseProgress } from '~/helpers/functions'
import { commandLabels } from '~/helpers/constants'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const terminal = useTerminalStore()
const settings = useSettingsStore()

const visible = computed(() => !settings.showTerminal && terminal.isRunning)

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

const lastLine = computed(() => {
  const lines = terminal.lines.filter(l => typeof l === 'string' && !l.startsWith('PROGRESS:'))
  const last = lines[lines.length - 1]
  return typeof last === 'string' ? (last.startsWith('\r') ? last.slice(1) : last) : ''
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
      v-if="visible"
      class="fixed bottom-24 right-4 z-50 w-80 rounded-lg border border-stone-100/10 bg-stone-900 p-3 shadow-lg"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 animate-spin text-amber-400" />
          <span class="truncate text-xs font-medium text-stone-100/60">{{ label }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="determinate" class="shrink-0 text-xs text-stone-100/55 tabular-nums">{{ progress!.current }} / {{ progress!.total }}</span>
          <UiButtonStop icon-only />
        </div>
      </div>

      <div class="mt-2">
        <UiLoadingPanel v-if="determinate" :percent="percent" variant="accent" size="sm" />
        <div v-else class="h-1 w-full overflow-hidden rounded-full bg-stone-800">
          <div class="h-1 w-full animate-pulse rounded-full bg-amber-400" />
        </div>
      </div>

      <p v-if="lastLine" class="mt-2 truncate font-mono text-2xs leading-4 text-stone-100/55">{{ lastLine }}</p>

      <UiButton
        v-if="terminal.hasLockError"
        variant="danger"
        size="sm"
        :icon="LockOpen"
        class="mt-2"
        @click="terminal.unlock()"
      >
        Force unlock
      </UiButton>
    </div>
  </Transition>
</template>
