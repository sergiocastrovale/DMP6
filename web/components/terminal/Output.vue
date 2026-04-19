<script setup lang="ts">
import { X, Square, Copy } from 'lucide-vue-next'
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
      class="fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-zinc-800 bg-zinc-950 lg:w-[500px]"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <span class="text-sm font-medium text-zinc-300">Terminal</span>
        <div class="flex items-center gap-2">
          <span v-if="terminal.isRunning" class="text-xs text-amber-500">Running...</span>
          <span
            v-else-if="terminal.exitCode !== null"
            class="text-xs"
            :class="terminal.exitCode === 0 ? 'text-green-500' : 'text-red-500'"
          >
            Exit: {{ terminal.exitCode }}
          </span>
          <button
            v-if="terminal.isRunning"
            @click="terminal.stop()"
            class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
            title="Stop process"
          >
            <Square :size="14" />
          </button>
          <button
            @click="terminal.close()"
            class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X :size="16" />
          </button>
        </div>
      </div>

      <!-- Tmux hint -->
      <div
        v-if="terminal.currentSession || terminal.isRunning"
        class="flex items-center gap-2 border-b border-zinc-800 px-4 py-2"
      >
        <span class="font-mono text-xs text-zinc-500">
          tmux attach-session -t {{ terminal.currentSession ?? '...' }}
        </span>
        <button
          v-if="terminal.currentSession"
          @click="copySession(terminal.currentSession!)"
          class="rounded p-0.5 text-zinc-600 hover:text-zinc-400"
          title="Copy"
        >
          <Copy :size="12" />
        </button>
      </div>

      <!-- Output -->
      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 text-zinc-300"
      >
        <div v-for="(line, i) in terminal.lines" :key="i" class="whitespace-pre-wrap break-all">{{ line }}</div>
        <span v-if="terminal.isRunning" class="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-amber-500" />
      </div>
    </div>
  </Transition>
</template>
