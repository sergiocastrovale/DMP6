<script setup lang="ts">
import { LucideSparkles } from 'lucide-vue-next'

const terminal = useTerminalStore()
</script>

<template>
  <UiButton variant="secondary" :icon="LucideSparkles" :loading="terminal.isRunning" @click="terminal.run('./playlists', [])">
    Generate Playlists
  </UiButton>
</template>
