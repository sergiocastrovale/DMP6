<script setup lang="ts">
import { X, Square, Copy, LockOpen } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

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
      class="fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-rule bg-bg lg:w-[500px]"
    >
      <div class="flex items-center justify-between border-b border-rule px-4 py-3">
        <span class="text-sm font-medium text-ink-2">Terminal</span>
        <div class="flex items-center gap-2">
          <span v-if="terminal.isRunning" class="text-xs text-accent">Running...</span>
          <span
            v-else-if="terminal.exitCode !== null"
            class="text-xs"
            :class="terminal.exitCode === 0 ? 'text-green-500' : 'text-red-500'"
          >
            Exit: {{ terminal.exitCode }}
          </span>
          <button
            v-if="terminal.isRunning"
            class="rounded p-1 text-ink-2 hover:bg-bg-2 hover:text-red-400"
            title="Stop process"
            @click="terminal.stop()"
          >
            <Square :size="14" />
          </button>
          <button
            class="rounded p-1 text-ink-2 hover:bg-bg-2 hover:text-ink"
            @click="terminal.close()"
          >
            <X :size="16" />
          </button>
        </div>
      </div>

      <div
        v-if="terminal.currentSession || terminal.isRunning"
        class="flex items-center gap-2 border-b border-rule px-4 py-2"
      >
        <span class="font-mono text-xs text-ink-3">
          tmux attach-session -t {{ terminal.currentSession ?? '...' }}
        </span>
        <button
          v-if="terminal.currentSession"
          class="rounded p-0.5 text-ink-4 hover:text-ink-2"
          title="Copy"
          @click="copySession(terminal.currentSession!)"
        >
          <Copy :size="12" />
        </button>
      </div>

      <div v-if="!terminal.isRunning" class="px-4 pt-3">
        <DroppedLinksNotice />
      </div>

      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 text-ink-2"
      >
        <div v-for="(line, i) in terminal.lines" :key="i" class="whitespace-pre-wrap break-all">{{ typeof line === 'string' && line.startsWith('\r') ? line.slice(1) : line }}</div>
        <span v-if="terminal.isRunning" class="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent" />
        <button
          v-if="terminal.hasLockError"
          class="mt-3 inline-flex items-center gap-1.5 rounded bg-red-900/50 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/80"
          @click="terminal.unlock()"
        >
          <LockOpen :size="12" />
          Force unlock
        </button>
      </div>
    </div>
  </Transition>
</template>
