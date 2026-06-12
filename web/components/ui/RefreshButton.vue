<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const props = defineProps<{ only?: string[]; folders?: string[] }>()
const terminal = useTerminalStore()

async function run() {
  terminal.open()
  if (props.folders?.length && props.only?.length) {
    await terminal.run('./index', ['--folders', props.folders.join(';')], 'refresh')
    await terminal.run('./sync', ['--only', props.only.join(';')], 'refresh')
  } else {
    const args = props.only?.length ? ['--only', props.only.join(';')] : []
    await terminal.run('./refresh', args, 'refresh')
  }
}
</script>

<template>
  <UiButton
    variant="secondary"
    size="sm"
    :icon="RefreshCw"
    :loading="terminal.isRunning"
    @click="run"
    :title="only?.length ? `Re-index + Re-sync: ${only.join(', ')}` : 'Re-index + Re-sync all'"
  >
    Re-index + Re-sync
    <span v-if="only?.length" class="text-xs text-ink0">({{ only.length }})</span>
  </UiButton>
</template>
