<script setup lang="ts">
import { Loader2, Terminal } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const terminal = useTerminalStore()
const settings = useSettingsStore()
const { collapsed } = useSidebar()
const { visible: chromeVisible, topbar: topbarVisible } = useChrome()

const gridCols = computed(() =>
  collapsed.value ? 'grid-cols-1 lg:grid-cols-[64px_1fr]' : 'grid-cols-1 lg:grid-cols-[240px_1fr]',
)
</script>

<template>
  <a
    v-if="chromeVisible"
    href="#main-content"
    class="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-amber-400 focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-on-accent"
  >
    Skip to content
  </a>

  <div class="flex flex-col h-screen bg-stone-950 text-stone-100 font-sans antialiased">
    <template v-if="chromeVisible">
      <div :class="['grid flex-1 overflow-hidden transition-all duration-200', gridCols]">
        <LayoutSidebar class="hidden lg:flex" />

        <div class="flex flex-col overflow-hidden min-w-0" :class="{ 'lg:mr-[500px]': terminal.isOpen && settings.showTerminal }">
          <!-- Labs drops the search bar: its experiments are canvases, not lists, so there is
               nothing on the page for a query to filter. The rest of the shell stays. -->
          <div v-if="topbarVisible" class="sticky top-0 z-30 border-b border-stone-100/6 bg-stone-950/85 backdrop-blur-[14px]">
            <div class="flex flex-col lg:flex-row lg:items-center lg:gap-12 lg:px-8 lg:h-[56px]">
              <LayoutSearchBar />
            </div>
          </div>

          <main id="main-content" class="overflow-y-auto flex-1 px-6 py-6 lg:px-8">
            <slot />
          </main>
        </div>
      </div>

      <PlayerAudioPlayer />
    </template>

    <!-- Cinema mode (Explore): the page provides its own full-viewport content and transport,
         so the sidenav/topbar/player bar would just be redundant chrome around it. -->
    <main v-else id="main-content" class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>

  <template v-if="chromeVisible">
    <LayoutMobileNav />
    <TerminalOutput v-if="settings.showTerminal" />
    <TerminalProgress />

    <button
      v-if="terminal.hasBackground && settings.showTerminal"
      type="button"
      class="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 text-sm text-stone-100/60 shadow-lg transition-colors duration-150 hover:border-stone-100/20 hover:bg-stone-800"
      @click="terminal.open()"
    >
      <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
      <Terminal :size="14" :stroke-width="ICON_STROKE_WIDTH" />
      <span>Terminal running</span>
    </button>
  </template>

  <LayoutToastHost />
</template>
