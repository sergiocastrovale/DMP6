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

// Global space-to-play/pause and left/right-to-seek, TV-remote style.
const player = usePlayerStore()
const visualizer = useVisualizer()

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
}

// A focused button/link already treats Space as "activate me" - letting it through too would
// both click the control and toggle playback.
const isActivatableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return ['BUTTON', 'A'].includes(target.tagName)
}

// Repeated arrow presses (or a held key, via native OS auto-repeat) ramp the seek step up like a
// remote's fast-forward, resetting once presses stop coming in quickly. Capped so a long hold
// doesn't fling you across an entire album.
const ARROW_SEEK_RESET_MS = 600
const ARROW_SEEK_BASE_SECONDS = 2
const ARROW_SEEK_MAX_SECONDS = 20
const ARROW_SEEK_MAX_STREAK = 9

let seekStreak = 0
let seekDir = 0
let lastSeekAt = 0

const seekStepSeconds = (streak: number): number =>
  Math.min(Math.round((ARROW_SEEK_BASE_SECONDS * 1.35 ** (streak - 1)) / 5) * 5, ARROW_SEEK_MAX_SECONDS)

const onGlobalKeydown = (event: KeyboardEvent) => {
  if (isTypingTarget(event.target)) {
    return
  }

  if (event.code === 'Space' && !event.repeat && player.currentTrack && !isActivatableTarget(event.target)) {
    event.preventDefault()
    player.togglePlay()
    return
  }

  // The visualizer's own Escape/preset keys live in its overlay; this is only the way in and out
  // from anywhere else in the app.
  if (event.code === 'KeyV' && !event.repeat && player.currentTrack) {
    event.preventDefault()
    visualizer.toggle()
    return
  }

  const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  // event.defaultPrevented lets a focused control that already owns arrow keys (the volume
  // slider) run its own handler first and opt this key press out of seeking.
  if (dir === 0 || !player.currentTrack || event.defaultPrevented) {
    return
  }
  event.preventDefault()

  const now = performance.now()
  seekStreak = dir === seekDir && now - lastSeekAt < ARROW_SEEK_RESET_MS ? Math.min(seekStreak + 1, ARROW_SEEK_MAX_STREAK) : 1
  seekDir = dir
  lastSeekAt = now

  const target = player.currentTime + dir * seekStepSeconds(seekStreak)
  player.seek(Math.min(Math.max(target, 0), player.duration || target))
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <a
    v-if="chromeVisible"
    href="#main-content"
    class="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-100 focus-visible:rounded-md focus-visible:bg-amber-400 focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-on-accent"
  >
    Skip to content
  </a>

  <!-- pb-[57px] on mobile reserves LayoutMobileNav's height (fixed, so it doesn't take flow space):
       without it the player bar - flush to the bottom of this h-screen column - sat directly behind
       the nav instead of above it. 57px matches the nav's own bottom-[57px] "More" sheet offset. -->
  <div
    class="flex flex-col h-screen bg-stone-950 text-stone-100 font-sans antialiased"
    :class="chromeVisible && 'pb-[57px] lg:pb-0'"
  >
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
          :class="chromeVisible ? 'md:p-6 lg:px-10 xl:px-12' : 'flex items-center justify-center'"
        >
          <slot />
        </main>
      </div>
    </div>

    <PlayerAudioPlayer v-if="chromeVisible && playerVisible" />
    <PlayerAudioPlayerMobile v-if="chromeVisible && playerVisible" />
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

  <!-- Outside the chromeVisible block on purpose: the visualizer is reachable from Explore while
       its cinema mode is on, and must survive route changes like the player bar does. -->
  <VisualizerOverlay />

  <LayoutToastHost />
</template>
