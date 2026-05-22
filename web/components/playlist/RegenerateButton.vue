<template>
  <button
    class="flex items-center gap-1.5 rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-2 hover:bg-bg-2 transition-colors disabled:opacity-50"
    :disabled="terminal.isRunning"
    @click="terminal.run('./playlists', [])"
  >
    <LucideLoader2 v-if="terminal.isRunning" class="size-3.5 animate-spin" />
    <LucideRefreshCw v-else class="size-3.5" />
    Regenerate
  </button>
</template>

<script setup lang="ts">
import { LucideRefreshCw, LucideLoader2 } from 'lucide-vue-next'

const terminal = useTerminalStore()
</script>
