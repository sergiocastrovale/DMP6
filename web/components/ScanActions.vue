<script setup lang="ts">
import { Search, RefreshCw, HardDriveDownload, Globe, Loader2 } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useTerminalStore } from '~/stores/terminal'
import { scanActions } from '~/helpers/constants'

const props = withDefaults(defineProps<{
  disabled?: boolean
  filter?: string[]
  overrides?: Record<string, { text?: string; subtext?: string }>
}>(), {
  disabled: false,
})

const terminal = useTerminalStore()

const scanIcons: Record<string, Component> = { Search, RefreshCw, HardDriveDownload, Globe }

const globalActions: Record<string, () => Promise<void>> = {
  'check': async () => {
    await terminal.run('./index', [])
    await terminal.run('./sync', [])
  },
  'index-sync': () => terminal.run('./refresh', []),
  'index': () => terminal.run('./index', []),
  'sync': () => terminal.run('./sync', []),
}

const visibleActions = computed(() => {
  const base = props.filter ? scanActions.filter(s => props.filter!.includes(s.id)) : scanActions
  return props.overrides
    ? base.map(s => ({ ...s, ...props.overrides![s.id] }))
    : base
})
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <button
      v-for="scan in visibleActions"
      :key="scan.id"
      :disabled="terminal.isRunning || disabled"
      class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      @click="globalActions[scan.id]!()"
    >
      <Loader2 v-if="terminal.isRunning" :size="20" class="shrink-0 animate-spin text-amber-500" />
      <component :is="scanIcons[scan.icon]" v-else :size="20" class="shrink-0 text-amber-500" />
      <div>
        <p class="text-sm font-medium text-zinc-50">{{ scan.text }}</p>
        <p class="text-xs text-zinc-500">{{ scan.subtext }}</p>
      </div>
    </button>
  </div>
</template>
