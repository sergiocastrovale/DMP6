<script setup lang="ts">
import { Search, RefreshCw, HardDriveDownload, Globe, FileSearch, Loader2 } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useTerminalStore } from '~/stores/terminal'
import { visibleScanActions } from '~/helpers/constants'

withDefaults(defineProps<{
  disabled?: boolean
}>(), {
  disabled: false,
})

const terminal = useTerminalStore()
const { isAdmin } = useAuth()

const scanIcons: Record<string, Component> = { Search, RefreshCw, HardDriveDownload, Globe, FileSearch }

const globalActions: Record<string, () => Promise<void>> = {
  'check': async () => {
    await terminal.run('./index', [])
    await terminal.run('./sync', [])
  },
  'full': async () => {
    await terminal.run('./index', ['--overwrite-with-images'])
    await terminal.run('./sync', ['--overwrite'])
  },
  // --inspect re-reads tags for files already in the DB (default index skips any known filePath), so
  // replaced or re-tagged files are picked up without a destructive --overwrite pass.
  'inspect': () => terminal.run('./index', ['--inspect']),
  'index': () => terminal.run('./index', []),
  'sync': () => terminal.run('./sync', []),
}

const visibleActions = computed(() => visibleScanActions(isAdmin.value))
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <button
      v-for="scan in visibleActions"
      :key="scan.id"
      :disabled="terminal.isRunning || disabled"
      class="flex items-center gap-3 rounded-xl border border-stone-100/6 bg-stone-900 p-4 text-left transition-colors duration-150 hover:border-stone-100/10 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
      @click="globalActions[scan.id]!()"
    >
      <Loader2 v-if="terminal.isRunning" :size="20" class="shrink-0 animate-spin text-amber-400" />
      <component :is="scanIcons[scan.icon]" v-else :size="20" class="shrink-0 text-amber-400" />
      <div>
        <p class="text-base font-medium text-stone-100">{{ scan.text }}</p>
        <p class="text-sm text-stone-100/55">{{ scan.subtext }}</p>
      </div>
    </button>
  </div>
</template>
