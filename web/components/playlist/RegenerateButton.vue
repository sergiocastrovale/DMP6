<template>
  <UiButton variant="secondary" size="sm" :icon="LucideRefreshCw" :loading="terminal.isRunning" @click="terminal.run('./playlists', [])">
    Regenerate
  </UiButton>
</template>

<script setup lang="ts">
import { LucideRefreshCw } from 'lucide-vue-next'

const terminal = useTerminalStore()
</script>
