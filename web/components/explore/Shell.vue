<script setup lang="ts">
import { Compass, Maximize, Minimize } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const { energy, era, familiarity, sound, isLoading, error, explore, playFromHistory } = useExplorer()
const { visible: chromeVisible, hide, show } = useChrome()

const configCollapsed = ref(false)

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
})
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8 pb-32">
    <PageTitle
      :icon="Compass"
      text="Explore"
      subtext="Tell us the mood, we pick a track from your library."
      class="mb-8"
    >
      <UiButton
        variant="secondary"
        size="sm"
        icon-only
        :icon="isFullscreen ? Minimize : Maximize"
        :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
        @click="toggleFullscreen"
      />
    </PageTitle>

    <div class="flex flex-col gap-8">
      <ExploreConfig
        v-model:energy="energy"
        v-model:era="era"
        v-model:familiarity="familiarity"
        v-model:sound="sound"
        :is-loading="isLoading"
        :error="error"
        :collapsed="configCollapsed"
        :changing="isChanging"
        @explore="onExplore"
        @expand="expandConfig"
        @cancel="cancelChanges"
      />

      <ExploreCard
        v-if="player.explorerCurrentTrack"
        :track="player.explorerCurrentTrack"
        :is-loading="isLoading"
        @again="onExplore"
      />

      <ExploreHistory
        v-if="player.explorerSessionHistory.length > 0"
        :tracks="player.explorerSessionHistory"
        @play="playFromHistory"
      />
    </div>
  </div>
</template>
