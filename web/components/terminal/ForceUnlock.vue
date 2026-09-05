<script setup lang="ts">
import { LockOpen } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()
</script>

<template>
  <UiButton
    v-if="terminal.hasLockError"
    variant="danger"
    size="sm"
    :icon="LockOpen"
    @click="terminal.unlock()"
  >
    Force unlock
  </UiButton>
</template>
