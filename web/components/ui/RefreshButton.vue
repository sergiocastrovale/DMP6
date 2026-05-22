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
  <button
    :disabled="terminal.isRunning"
    @click="run"
    class="flex items-center gap-2 rounded border border-rule bg-bg-2 px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-ink-4 hover:text-white disabled:opacity-50"
    :title="only?.length ? `Re-index + Re-sync: ${only.join(', ')}` : 'Re-index + Re-sync all'"
  >
    <RefreshCw :size="14" :class="terminal.isRunning ? 'animate-spin' : ''" />
    Re-index + Re-sync
    <span v-if="only?.length" class="text-xs text-ink0">({{ only.length }})</span>
  </button>
</template>
