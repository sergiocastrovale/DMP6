<script setup lang="ts">
import { LucideRefreshCw, LucideSparkles } from 'lucide-vue-next'

withDefaults(defineProps<{ regenerate?: boolean }>(), { regenerate: false })

const terminal = useTerminalStore()
</script>

<template>
  <UiButton
    variant="secondary"
    :size="regenerate ? 'sm' : 'md'"
    :icon="regenerate ? LucideRefreshCw : LucideSparkles"
    :loading="terminal.isRunning"
    @click="terminal.run('./playlists', [])"
  >
    <span class="hidden lg:block">{{ regenerate ? 'Regenerate' : 'Generate Playlists' }}</span>
  </UiButton>
</template>
