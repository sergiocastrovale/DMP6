<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { cx, layout } from '~/helpers/ui'

const player = usePlayerStore()
const { energy, era, familiarity, sound, isLoading, error, explore, playFromHistory } = useExplorer()
const { visible: chromeVisible, hide, show, hidePlayer, showPlayer } = useChrome()

// Explore has its own transport (ExploreCard), so the persistent player bar would just duplicate
// it - hidden for the whole visit, independent of cinema mode, restored on leaving.
hidePlayer()

const configCollapsed = ref(!!player.explorerCurrentTrack)

// Re-opening the dials over an already-playing track is a reversible edit: snapshot the four values
// on expand so "Cancel changes" can put them back. A first run has nothing to return to, so the
// snapshot (and the Cancel button with it) only exists while a track is already playing.
const snapshot = ref<{ energy: number, era: number, familiarity: number, sound: number } | null>(null)
const isChanging = computed(() => snapshot.value !== null)

const expandConfig = () => {
  snapshot.value = { energy: energy.value, era: era.value, familiarity: familiarity.value, sound: sound.value }
  configCollapsed.value = false
}

const cancelChanges = () => {
  if (!snapshot.value) {
    return
  }
  energy.value = snapshot.value.energy
  era.value = snapshot.value.era
  familiarity.value = snapshot.value.familiarity
  sound.value = snapshot.value.sound
  snapshot.value = null
  configCollapsed.value = true
}

const onExplore = async () => {
  await explore()
  if (player.explorerCurrentTrack) {
    snapshot.value = null
    configCollapsed.value = true
  }
}

const isFullscreen = computed(() => !chromeVisible.value)

let previouslyFocused: HTMLElement | null = null

const enterFullscreen = () => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  hide()
}

const exitFullscreen = () => {
  show()
  previouslyFocused?.focus()
  previouslyFocused = null
}

const toggleFullscreen = () => (isFullscreen.value ? exitFullscreen() : enterFullscreen())

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && isFullscreen.value) {
    exitFullscreen()
  }
}

// document is undefined during SSR - isFullscreen always starts false (chrome starts visible),
// so there is nothing to attach on the very first (server) render. A plain (non-immediate)
// watch only ever fires on a later, client-side change.
watch(isFullscreen, (active) => {
  if (active) {
    document.addEventListener('keydown', onKeydown)
  }
  else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  // Safety net: leaving Explore always restores the shell, even if that happens some way other
  // than the Escape/toggle handlers above (e.g. a programmatic navigation while in cinema mode).
  show()
  showPlayer()
})
</script>

<template>
  <div :class="cx(layout.page)">
    <PageTitle
      text="Explore"
      :hide-text="isFullscreen"
    >
      <div :class="cx('flex items-center gap-5', isFullscreen && 'fixed top-4 right-4 z-40')">
        <VisualizerToggleButton />

        <ExploreFullscreenButton class="hidden lg:block" :fullscreen="isFullscreen" @toggle-fullscreen="toggleFullscreen" />
      </div>
    </PageTitle>

    <div class="flex flex-col gap-5 lg:gap-8" :class="isFullscreen && 'mt-12'">
      <ExploreConfig
        v-model:energy="energy"
        v-model:era="era"
        v-model:familiarity="familiarity"
        v-model:sound="sound"
        :is-loading="isLoading"
        :error="error"
        :collapsed="configCollapsed"
        :changing="isChanging"
        :tv="isFullscreen"
        @explore="onExplore"
        @expand="expandConfig"
        @cancel="cancelChanges"
      />

      <ExploreCard
        v-if="player.explorerCurrentTrack"
        :track="player.explorerCurrentTrack"
        :tv="isFullscreen"
      />

      <ExploreHistory
        v-if="player.explorerSessionHistory.length > 0"
        :tracks="player.explorerSessionHistory"
        :tv="isFullscreen"
        @play="playFromHistory"
      />
    </div>
  </div>
</template>
