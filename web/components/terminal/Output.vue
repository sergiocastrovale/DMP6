<script setup lang="ts">
import { Copy, LockOpen, Square, X } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

function copySession(session: string) {
  navigator.clipboard.writeText(`tmux attach-session -t ${session}`)
}

const terminal = useTerminalStore()

const scrollContainer = ref<HTMLElement | null>(null)

watch(() => terminal.lines.length, () => {
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
})
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition-transform duration-300 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="terminal.isOpen"
      class="fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-stone-100/10 bg-stone-950 lg:w-[500px]"
    >
      <div class="flex items-center justify-between border-b border-stone-100/6 px-4 py-3">
        <span class="text-sm font-medium text-stone-100/60">Terminal</span>
        <div class="flex items-center gap-2">
          <span v-if="terminal.isRunning" class="text-xs text-amber-400">Running...</span>
          <span
            v-else-if="terminal.exitCode !== null"
            class="text-xs"
            :class="terminal.exitCode === 0 ? 'text-success' : 'text-danger'"
          >
            Exit: {{ terminal.exitCode }}
          </span>
          <button
            v-if="terminal.isRunning"
            type="button"
            title="Stop process"
            class="rounded-md p-1 text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-danger"
            @click="terminal.stop()"
          >
            <Square :size="14" :stroke-width="ICON_STROKE_WIDTH" />
          </button>
          <button
            type="button"
            aria-label="Close terminal"
            class="rounded-md p-1 text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100"
            @click="terminal.close()"
          >
            <X :size="16" :stroke-width="ICON_STROKE_WIDTH" />
          </button>
        </div>
      </div>

      <div
        v-if="terminal.currentSession || terminal.isRunning"
        class="flex items-center gap-2 border-b border-stone-100/6 px-4 py-2"
      >
        <span class="font-mono text-xs text-stone-100/40">
          tmux attach-session -t {{ terminal.currentSession ?? '...' }}
        </span>
        <button
          v-if="terminal.currentSession"
          type="button"
          title="Copy"
          class="rounded-sm p-0.5 text-stone-100/30 transition-colors duration-150 hover:text-stone-100/60"
          @click="copySession(terminal.currentSession!)"
        >
          <Copy :size="12" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>

      <div v-if="!terminal.isRunning" class="px-4 pt-3">
        <DroppedLinksNotice />
      </div>

      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 text-stone-100/60"
      >
        <div v-for="(line, i) in terminal.lines" :key="i" class="whitespace-pre-wrap break-all">{{ typeof line === 'string' && line.startsWith('\r') ? line.slice(1) : line }}</div>
        <span v-if="terminal.isRunning" class="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-amber-400" />
        <button
          v-if="terminal.hasLockError"
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25"
          @click="terminal.unlock()"
        >
          <LockOpen :size="12" :stroke-width="ICON_STROKE_WIDTH" />
          Force unlock
        </button>
      </div>
    </div>
  </Transition>
</template>
