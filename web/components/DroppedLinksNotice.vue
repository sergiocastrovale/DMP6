<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { parseDroppedLinks } from '~/helpers/functions'

const terminal = useTerminalStore()

const dropped = computed(() => parseDroppedLinks(terminal.lines))
</script>

<template>
  <div
    v-if="dropped"
    class="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
  >
    <AlertTriangle :size="14" class="mt-0.5 shrink-0" />
    <span>
      {{ dropped.favorites }} favorite(s) and {{ dropped.playlists }} playlist entry(ies) were removed
      with tracks whose files are gone. Files replaced under a new name become new tracks - re-add them
      to keep the link.
    </span>
  </div>
</template>
