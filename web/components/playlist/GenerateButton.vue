<script setup lang="ts">
import { LucideSparkles, LucideLoader2 } from 'lucide-vue-next'

const terminal = useTerminalStore()
</script>

<template>
  <button
    class="flex items-center gap-1.5 rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-bg-2 disabled:opacity-50"
    :disabled="terminal.isRunning"
    @click="terminal.run('./playlists', [])"
  >
    <LucideLoader2 v-if="terminal.isRunning" class="size-4 animate-spin" />
    <LucideSparkles v-else class="size-4" />
    Generate Playlists
  </button>
</template>
