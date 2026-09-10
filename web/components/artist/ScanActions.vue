<script setup lang="ts">
import { RefreshCw, Loader2, Search, HardDriveDownload, Globe } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ButtonDropdownOption } from '~/types/ui'
import { useTerminalStore } from '~/stores/terminal'
import { visibleArtistScanActions } from '~/helpers/constants'
import { scanSessionName } from '~/helpers/functions'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  artistName: string
  folders: string[]
}>()

const terminal = useTerminalStore()
const { isAdmin } = useAuth()

const scanIcons: Record<string, Component> = { Search, RefreshCw, HardDriveDownload, Globe }

// `./delete` prompts for confirmation on stdin, which nothing answers in a tmux-backed run - `--y` is
// what keeps the rebuilds from hanging there forever. It scopes by artist name; index scopes by the
// artist's on-disk folders, which is why the two take different arguments.
//
// index takes `--folders`, not `--only`: `--only` matches whole top-level directories, so a release
// this artist co-owns inside another artist's directory dragged that artist's entire catalogue into
// every scan. artistScanFolders() hands back the artist's own roots plus the exact album folders
// elsewhere, and index walks each entry as given.
const artistActions: Record<string, (name: string, folders: string[]) => () => Promise<void>> = {
  'check': (name, folders) => async () => {
    const session = scanSessionName('check', name)
    await terminal.runSequence([
      { command: './index', args: ['--folders', folders.join(';')], session },
      { command: './sync', args: ['--only', name, '--exact'], session },
    ])
  },
  'rebuild': (name, folders) => async () => {
    const session = scanSessionName('rebuild', name)
    await terminal.runSequence([
      { command: './delete', args: [name, '--y'], session },
      { command: './index', args: ['--folders', folders.join(';'), '--overwrite'], session },
      { command: './sync', args: ['--only', name, '--exact', '--overwrite'], session },
    ])
  },
  'reindex': (name, folders) => async () => {
    const session = scanSessionName('reindex', name)
    await terminal.runSequence([
      { command: './delete', args: [name, '--y'], session },
      { command: './index', args: ['--folders', folders.join(';'), '--overwrite'], session },
    ])
  },
  'resync': (name) => async () => {
    await terminal.run('./sync', ['--only', name, '--exact', '--overwrite'], scanSessionName('resync', name))
  },
}

const syncOptions = computed<ButtonDropdownOption[]>(() =>
  visibleArtistScanActions(isAdmin.value).map(s => ({
    label: s.text,
    description: s.subtext,
    icon: scanIcons[s.icon],
    action: artistActions[s.id]!(props.artistName, props.folders),
  })),
)
</script>

<template>
  <ArtistButtonDropdown
    label="Scan"
    :options="syncOptions"
    :disabled="terminal.isRunning"
  >
    <template #icon>
      <Loader2 v-if="terminal.isRunning" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
      <RefreshCw v-else :size="14" />
    </template>
  </ArtistButtonDropdown>
</template>
