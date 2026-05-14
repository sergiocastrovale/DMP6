<script setup lang="ts">
import { Loader2, Terminal } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { useTerminalStore } from '~/stores/terminal'

const route = useRoute()
const player = usePlayerStore()
const terminal = useTerminalStore()

const mainClasses = computed(() => {
  const extraClasses = (route.meta?.layoutClasses as string) ?? 'px-4 py-6 lg:px-6'

  return {
    'pb-40 lg:pb-24': player.isVisible,
    'pb-20 lg:pb-6': !player.isVisible,
    [extraClasses]: true,
  }
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-50">
    <LayoutSidebar class="hidden lg:flex" />

    <LayoutMobileNav />

    <div class="lg:ml-56 transition-all duration-300" :class="{ 'lg:mr-[500px]': terminal.isOpen }">
      <header class="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur-sm lg:px-6">
        <LayoutSearchBar />
      </header>

      <main :class="mainClasses">
        <slot />
      </main>
    </div>

    <TerminalOutput />

    <button
      v-if="terminal.hasBackground"
      @click="terminal.open()"
      class="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 shadow-lg transition-colors hover:border-zinc-600 hover:bg-zinc-800"
    >
      <Loader2 :size="14" class="animate-spin text-amber-500" />
      <Terminal :size="14" />
      <span>Terminal running</span>
    </button>

    <DownloadsIndicator />

    <PlayerAudioPlayer />
  </div>
</template>
