<script setup lang="ts">
import { RefreshCw, Loader2, Search, HardDriveDownload, Globe, ListChecks } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ButtonDropdownOption } from '~/types/ui'
import { useTerminalStore } from '~/stores/terminal'
import { scanActions } from '~/helpers/constants'

const props = defineProps<{
  artistName: string
  folders: string[]
}>()

const terminal = useTerminalStore()

const scanIcons: Record<string, Component> = { Search, RefreshCw, HardDriveDownload, Globe, ListChecks }

const artistActions: Record<string, (name: string, folders: string[]) => () => Promise<void>> = {
  'check': (name, folders) => async () => {
    await terminal.run('./index', ['--only', folders.join(';'), '--exact'])
    await terminal.run('./sync', ['--only', name, '--exact'])
  },
  'index-sync': (name, folders) => async () => {
    await terminal.run('./index', ['--only', folders.join(';'), '--exact', '--overwrite'])
    await terminal.run('./sync', ['--only', name, '--exact', '--overwrite'])
  },
  'index': (_name, folders) => async () => {
    await terminal.run('./index', ['--only', folders.join(';'), '--exact', '--overwrite'])
  },
  'sync': (name) => async () => {
    await terminal.run('./sync', ['--only', name, '--exact', '--overwrite'])
  },
  'catalogue-gaps': (name) => async () => {
    await terminal.run('./sync', ['--only', name, '--exact', '--catalogue-gaps'])
  },
}

const syncOptions = computed<ButtonDropdownOption[]>(() =>
  scanActions.map(s => ({
    label: s.text,
    description: s.subtext,
    icon: scanIcons[s.icon],
    action: artistActions[s.id]!(props.artistName, props.folders),
  })),
)
</script>

<template>
  <ButtonDropdown
    label="Scan catalogue"
    :options="syncOptions"
    :disabled="terminal.isRunning"
  >
    <template #icon>
      <Loader2 v-if="terminal.isRunning" :size="14" class="animate-spin" />
      <RefreshCw v-else :size="14" />
    </template>
  </ButtonDropdown>
</template>
