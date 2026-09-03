<script setup lang="ts">
import { VISUALIZER_HUD_IDLE_MS, visualizerPresets } from '~/helpers/constants'

// The app's other full-screen experience (Explore's cinema mode) works by flipping useChrome() and
// letting AppShell unmount around a stable <main>. This one can't: requestFullscreen needs a real
// element to promote, and the overlay has to sit ABOVE cinema mode rather than replace it - the
// visualizer is reachable from the Explore page while that mode is already on. So it is a teleported
// fixed layer, the second sanctioned full-screen pattern (see docs/design_system.md).

const { active, preset, close, setPreset, nextPreset } = useVisualizer()

const containerRef = ref<HTMLElement>()
const hudVisible = ref(true)

let idleTimer: ReturnType<typeof setTimeout> | null = null
let previouslyFocused: HTMLElement | null = null

const clearIdleTimer = () => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

const markActivity = () => {
  hudVisible.value = true
  clearIdleTimer()
  idleTimer = setTimeout(() => { hudVisible.value = false }, VISUALIZER_HUD_IDLE_MS)
}

const isFullscreen = (): boolean => !!document.fullscreenElement

const onKeydown = (event: KeyboardEvent) => {
  markActivity()

  if (event.key === 'Escape') {
    // Native fullscreen swallows Escape and exits on its own, which onFullscreenChange picks up.
    // This branch is what closes the overlay in the CSS-only fallback, where nothing else would.
    if (!isFullscreen()) {
      close()
    }
    return
  }

  const byKey = visualizerPresets.find(p => p.key === event.key)
  if (byKey) {
    event.preventDefault()
    setPreset(byKey.id)
    return
  }

  if (event.key === 'n') {
    event.preventDefault()
    nextPreset()
  }
  // Space and the arrow keys deliberately fall through to AppShell's global transport handler, so
  // play/pause and seeking work here exactly as they do on any other screen.
}

const onFullscreenChange = () => {
  // Covers every way out of native fullscreen: Escape, F11, the browser's own control.
  if (active.value && !isFullscreen()) {
    close()
  }
}

const addListeners = () => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
}

const removeListeners = () => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
}

const enter = async () => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  addListeners()
  markActivity()
  await nextTick()
  try {
    // iOS Safari rejects requestFullscreen on anything but a <video>. The overlay is already a
    // full-viewport fixed layer, so a rejection costs nothing but the browser chrome staying up.
    await containerRef.value?.requestFullscreen?.()
  }
  catch { /* CSS-only fullscreen is the fallback, and Escape is handled above */ }
}

const leave = () => {
  removeListeners()
  clearIdleTimer()
  if (isFullscreen()) {
    document.exitFullscreen().catch(() => { /* already gone */ })
  }
  previouslyFocused?.focus()
  previouslyFocused = null
}

// Not `immediate` - an immediate watcher runs synchronously during setup, i.e. on the server, where
// there is no document. `active` always starts false, so there is nothing to do on first render.
watch(active, (open) => (open ? enter() : leave()))

onBeforeUnmount(() => {
  removeListeners()
  clearIdleTimer()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      ref="containerRef"
      class="fixed inset-0 z-100 overflow-hidden bg-black"
      data-testid="visualizer-overlay"
      @pointermove="markActivity"
      @pointerdown="markActivity"
    >
      <VisualizerCanvas :preset="preset" />
      <VisualizerHud :visible="hudVisible" @close="close()" />
    </div>
  </Teleport>
</template>
