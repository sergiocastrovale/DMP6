<script setup lang="ts">
import { Square } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

withDefaults(defineProps<{ iconOnly?: boolean }>(), { iconOnly: false })

const terminal = useTerminalStore()
</script>

<template>
  <UiButton
    :variant="iconOnly ? 'ghost' : 'danger'"
    size="sm"
    :icon-only="iconOnly"
    :icon="Square"
    :title="iconOnly ? 'Stop process' : undefined"
    :class="iconOnly ? 'hover:text-danger' : undefined"
    @click="terminal.stop()"
  >
    Stop
  </UiButton>
</template>
