<script setup lang="ts">
import { Loader2, Terminal } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const terminal = useTerminalStore()
const settings = useSettingsStore()
const { collapsed } = useSidebar()
const { visible: chromeVisible, topbar: topbarVisible, player: playerVisible } = useChrome()

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
    <!-- `<main>` (and the page it slots in) stays a single stable element across chromeVisible
         toggles - the sidenav/topbar/player bar mount and unmount around it instead of the page
         living in two structurally different v-if/v-else branches. That used to unmount+remount
         the whole page (losing its local state) every time cinema mode (Explore) toggled, because
         Vue can't patch across a structural change in the tree, only diff same-position children. -->
    <div
      class="flex flex-1 overflow-hidden transition-all duration-200"
      :class="chromeVisible && ['grid', gridCols]"
    >
      <LayoutSidebar v-if="chromeVisible" class="hidden lg:flex" />

      <div class="flex flex-1 flex-col overflow-hidden min-w-0" :class="{ 'lg:mr-125': chromeVisible && terminal.isOpen && settings.showTerminal }">
        <!-- Labs drops the search bar: its experiments are canvases, not lists, so there is
             nothing on the page for a query to filter. The rest of the shell stays. -->
        <div v-if="chromeVisible && topbarVisible" class="sticky top-0 z-30 backdrop-blur-[14px]">
          <div class="flex flex-col lg:flex-row lg:items-center lg:gap-12 lg:px-8 lg:h-20">
            <LayoutSearchBar />
          </div>
        </div>

        <main
          id="main-content"
          class="overflow-y-auto flex-1"
          :class="chromeVisible ? 'px-6 py-6 lg:px-10 xl:px-12' : 'flex items-center justify-center'"
        >
          <slot />
        </main>
      </div>
    </div>

    <PlayerAudioPlayer v-if="chromeVisible && playerVisible" />
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
