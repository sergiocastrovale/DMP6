<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const props = defineProps<{ only?: string[] }>()
const terminal = useTerminalStore()

function run() {
  const args = props.only?.length ? ['--only', props.only.join(';')] : []
  terminal.run('./refresh', args, 'refresh')
  terminal.open()
}
</script>

<template>
  <button
    :disabled="terminal.isRunning"
    @click="run"
    class="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
    :title="only?.length ? `Re-index + Re-sync: ${only.join(', ')}` : 'Re-index + Re-sync all'"
  >
    <RefreshCw :size="14" :class="terminal.isRunning ? 'animate-spin' : ''" />
    Re-index + Re-sync
    <span v-if="only?.length" class="text-xs text-zinc-500">({{ only.length }})</span>
  </button>
</template>
