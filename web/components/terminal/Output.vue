<script setup lang="ts">
import { Copy, LockOpen, Square, X } from 'lucide-vue-next'
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
          <UiButton
            v-if="terminal.isRunning"
            variant="ghost"
            size="sm"
            icon-only
            :icon="Square"
            title="Stop process"
            class="hover:text-danger"
            @click="terminal.stop()"
          />
          <UiButton
            variant="ghost"
            size="md"
            icon-only
            :icon="X"
            aria-label="Close terminal"
            @click="terminal.close()"
          />
        </div>
      </div>

      <div
        v-if="terminal.currentSession || terminal.isRunning"
        class="flex items-center gap-2 border-b border-stone-100/6 px-4 py-2"
      >
        <span class="font-mono text-xs text-stone-100/55">
          tmux attach-session -t {{ terminal.currentSession ?? '...' }}
        </span>
        <UiButton
          v-if="terminal.currentSession"
          variant="ghost"
          size="sm"
          icon-only
          :icon="Copy"
          title="Copy"
          @click="copySession(terminal.currentSession!)"
        />
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
        <UiButton
          v-if="terminal.hasLockError"
          variant="danger"
          size="sm"
          :icon="LockOpen"
          class="mt-3"
          @click="terminal.unlock()"
        >
          Force unlock
        </UiButton>
      </div>
    </div>
  </Transition>
</template>
