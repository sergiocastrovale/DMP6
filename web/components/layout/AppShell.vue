<script setup lang="ts">
import { Loader2, Terminal } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'

const terminal = useTerminalStore()
const { collapsed } = useSidebar()

const gridCols = computed(() =>
  collapsed.value ? 'grid-cols-1 lg:grid-cols-[72px_1fr]' : 'grid-cols-1 lg:grid-cols-[240px_1fr]',
)
</script>

<template>
  <div class="flex flex-col h-screen bg-bg text-ink font-sans antialiased">
    <div :class="['grid flex-1 overflow-hidden transition-all duration-200', gridCols]">
      <LayoutSidebar class="hidden lg:flex" />

      <div class="flex flex-col overflow-hidden min-w-0" :class="{ 'lg:mr-[500px]': terminal.isOpen }">
        <div class="sticky top-0 z-30 border-b border-rule bg-bg">
          <div class="flex flex-col lg:flex-row lg:items-center lg:gap-12 lg:px-8 lg:h-18">
            <LayoutSearchBar />
          </div>
        </div>

        <div class="overflow-y-auto flex-1 px-6 py-6 lg:px-8">
          <slot />
        </div>
      </div>
    </div>

    <PlayerAudioPlayer />
  </div>

  <LayoutMobileNav />
  <TerminalOutput />

  <button
    v-if="terminal.hasBackground"
    class="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-lg border border-rule bg-bg-2 px-3 py-2 text-sm text-ink-2 shadow-lg transition-colors hover:border-ink-4 hover:bg-bg-3"
    @click="terminal.open()"
  >
    <Loader2 :size="14" class="animate-spin text-accent" />
    <Terminal :size="14" />
    <span>Terminal running</span>
  </button>

  <DownloadsIndicator />
</template>
