<script setup lang="ts">
import { AudioLines } from 'lucide-vue-next'
import { createVisualizerRenderer } from '~/helpers/visualizer/renderer'
import { getBoundaryJuliaPath, juliaCAlongPath } from '~/helpers/visualizer/juliaPath'
import { lerpHue } from '~/helpers/visualizer/hueMorph'
import { decayPeaks, isBeat, rms, smoothTowards, splitBands } from '~/helpers/audioBands'
import { oklchToHueDegrees } from '~/helpers/oklch'
import { themes, type VisualizerPresetId } from '~/helpers/constants'
import { usePlayerStore } from '~/stores/player'
import type { VisualizerRenderer } from '~/types/visualizer'

const props = defineProps<{ preset: VisualizerPresetId }>()

const player = usePlayerStore()
const { accent } = useTheme()
const { attach, resume, read, binCount } = useAudioAnalyser()

// Per-frame lerp factors. A rise is followed almost immediately so a kick lands on the beat; the
// fall is eased so the shape doesn't strobe between frames.
const BAND_ATTACK = 0.55
const BAND_RELEASE = 0.12
const LEVEL_ATTACK = 0.4
const LEVEL_RELEASE = 0.08
// Bytes a peak cap sinks per frame (~1.5s from full scale to zero at 60fps).
const PEAK_FALL = 2.8
// How fast the Chaos preset walks its precomputed boundary path (in loops per second - the path
// is a closed loop, so 1 lap = phase advancing by 1). Slow: every step along it is a completely
// different Julia set, so this is the preset's "shape changes" rate, not its motion - the spin and
// zoom in the shader supply the motion, independently sped up or down.
// 0.008 -> 0.002 (4x slower, per request).
const JULIA_SWEEP = 0.002
// prefers-reduced-motion neutralises CSS animation app-wide (assets/css/main.css) but cannot reach
// a requestAnimationFrame loop, so the clock is damped here instead. The visuals still respond to
// the music; they just stop drifting on their own.
const REDUCED_MOTION_TIME_SCALE = 0.15

// Fractal is the preset whose shape and zoom are driven straight off uBass (Chaos's camera
// transform is deliberately audio-blind entirely - see helpers/visualizer/shaders.ts), so it used
// to react to every single kick, which read as the fractal jerking on every hit. This gates that
// reaction: the bass value Fractal actually receives is held constant except right after a real
// beat, at intervals of 5-9s - a quiet stretch, then one clean jump on the beat, then quiet again,
// rather than constant jitter. Tunnel and Spectrum's own (much smaller) uBass touches are
// untouched - only Fractal was asked about.
const FRACTAL_FREEZE_MIN_S = 5
const FRACTAL_FREEZE_MAX_S = 9
// A kick has to clear its own recent average by this multiple to count as a beat, and clear this
// absolute floor too, so near-silence noise on the baseline ratio can't false-trigger.
const BEAT_RATIO = 1.5
const BEAT_FLOOR = 0.12
// The baseline is a rolling average, not an envelope follower - slow both ways, unlike BAND_ATTACK
// above, or it would just track the kick itself instead of the level around it.
const BEAT_BASELINE_SMOOTH = 0.03
const randomFreezeInterval = () =>
  FRACTAL_FREEZE_MIN_S + Math.random() * (FRACTAL_FREEZE_MAX_S - FRACTAL_FREEZE_MIN_S)

// Chaos's colour used to drift continuously via the shared freeColor()/hueBase() formula (still
// what Fractal/Tunnel use), but Chaos's shape moves fast enough (spin, zoom, the Julia path) that
// even that slow drift read as the colour jumping rather than gliding. This instead morphs
// explicitly between two hues, A to B, over a random duration - never an instant cut.
const CHAOS_MORPH_MIN_S = 5
const CHAOS_MORPH_MAX_S = 11
const randomMorphDuration = () =>
  CHAOS_MORPH_MIN_S + Math.random() * (CHAOS_MORPH_MAX_S - CHAOS_MORPH_MIN_S)

const canvasRef = ref<HTMLCanvasElement>()
const unsupported = ref(false)

let renderer: VisualizerRenderer | null = null
let observer: ResizeObserver | null = null
let frameHandle = 0
let startedAt = 0
let clock = 0
let bass = 0
let mid = 0
let treble = 0
let level = 0
let peaks = new Uint8Array(0)
let bassBaseline = 0
// Starts already "due" (0), so the very first beat of the session triggers a jump immediately
// instead of waiting out a full freeze window with a stale zero.
let fractalFreezeUntil = 0
let fractalFrozenBass = 0
// Free-running presets read this instead of the accent hue (see helpers/visualizer/shaders.ts'
// freeColor) - re-rolled on mount and on every preset switch so opening the overlay, or cycling
// through presets, always lands on a fresh, unpredictable starting colour.
let colorSeed = Math.random()
// Chaos's own hue morph state: ease from chaosHueFrom to chaosHueTo, starting at chaosMorphStart,
// over chaosMorphDuration seconds. Initialised already "mid-flight" (from a random point, towards
// another) rather than pinned to a fixed starting hue, for the same reason colorSeed is randomised
// above - opening the overlay should never look the same twice.
let chaosHueFrom = Math.random()
let chaosHueTo = Math.random()
let chaosMorphStart = 0
let chaosMorphDuration = randomMorphDuration()
// Byte time-domain silence sits at 128, not 0, so the fallback below has to be its own buffer -
// handing the shader a zeroed array would peg the oscilloscope to the bottom of the screen
// instead of drawing a flat line through the middle.
let silence = new Uint8Array(0)
let timeScale = 1

// The shader picks colour off an HSV wheel, so the authored oklch triple has to be converted -
// the two hue angles are different numbers (see helpers/oklch.ts).
const hue = computed(() => {
  const theme = themes.find(t => t.id === accent.value) ?? themes[0]
  return oklchToHueDegrees(...theme.oklch)
})

const renderFrame = (now: number) => {
  frameHandle = requestAnimationFrame(renderFrame)
  if (!renderer) {
    return
  }

  const elapsed = startedAt === 0 ? 0 : (now - startedAt) / 1000
  startedAt = now
  clock += Math.min(elapsed, 0.1) * timeScale

  const data = read()
  if (data) {
    const bands = splitBands(data.freq)
    bass = smoothTowards(bass, bands.bass, BAND_ATTACK, BAND_RELEASE)
    mid = smoothTowards(mid, bands.mid, BAND_ATTACK, BAND_RELEASE)
    treble = smoothTowards(treble, bands.treble, BAND_ATTACK, BAND_RELEASE)
    level = smoothTowards(level, rms(data.time), LEVEL_ATTACK, LEVEL_RELEASE)
    decayPeaks(peaks, data.freq, PEAK_FALL)

    bassBaseline = smoothTowards(bassBaseline, bands.bass, BEAT_BASELINE_SMOOTH, BEAT_BASELINE_SMOOTH)
    // Only take the beat once the freeze window has actually elapsed - a beat arriving mid-freeze
    // is exactly the jitter this exists to ignore.
    if (clock >= fractalFreezeUntil && isBeat(bands.bass, bassBaseline, BEAT_RATIO, BEAT_FLOOR)) {
      fractalFrozenBass = bass
      fractalFreezeUntil = clock + randomFreezeInterval()
    }
  }

  // Ease from chaosHueFrom to chaosHueTo; once that arc completes, the arrival hue becomes the new
  // departure point and a fresh random target and duration are picked - an unbroken chain of
  // A-to-B morphs, never a jump back to some fixed reference hue.
  const morphT = (clock - chaosMorphStart) / chaosMorphDuration
  const chaosHue = lerpHue(chaosHueFrom, chaosHueTo, morphT)
  if (morphT >= 1) {
    chaosHueFrom = chaosHueTo
    chaosHueTo = Math.random()
    chaosMorphStart = clock
    chaosMorphDuration = randomMorphDuration()
  }

  renderer.draw({
    time: clock,
    // Every other preset gets the live envelope; Fractal (the only uBass consumer - see the
    // comment on FRACTAL_FREEZE_MIN_S above) gets the gated value instead.
    bass: props.preset === 'fractal' ? fractalFrozenBass : bass,
    mid,
    treble,
    level,
    hue: hue.value,
    colorSeed,
    chaosHue,
    // getBoundaryJuliaPath() builds its (smoothed, always-outside) path once and caches it - this
    // is a cheap array lookup every frame after that, never a live per-frame search. Walking a
    // precomputed path rather than calling the search directly is what makes the shape morph
    // continuously instead of jump-cutting: the raw search's own bisection can legitimately land
    // on unrelated points for barely-different inputs (the escape-time landscape right at the
    // Mandelbrot boundary is itself discontinuous), and a Julia set is sensitive enough to c that
    // even a small jump there reads as the entire fractal jumping.
    juliaC: juliaCAlongPath(getBoundaryJuliaPath(), clock * JULIA_SWEEP),
    spectrum: data?.freq ?? peaks,
    waveform: data?.time ?? silence,
    peaks,
  })
}

const stopLoop = () => {
  if (frameHandle) {
    cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }
}

const startLoop = () => {
  if (frameHandle || !renderer) {
    return
  }
  // A fresh baseline, so a loop resumed after a hidden tab doesn't jump the clock by however long
  // the tab was in the background.
  startedAt = 0
  frameHandle = requestAnimationFrame(renderFrame)
}

// Nothing to draw while the tab is in the background, and the analyser reads silence anyway.
const onVisibilityChange = () => (document.hidden ? stopLoop() : startLoop())

watch(() => props.preset, (preset) => {
  renderer?.setPreset(preset)
  colorSeed = Math.random()
  chaosHueFrom = Math.random()
  chaosHueTo = Math.random()
  chaosMorphStart = clock
  chaosMorphDuration = randomMorphDuration()
})

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }

  // The click that opened the overlay is the user gesture an AudioContext needs to leave its
  // suspended state - spend it here, before the first frame.
  attach(player.getAudioElement())
  resume()

  const bins = binCount()
  peaks = new Uint8Array(bins)
  silence = new Uint8Array(bins).fill(128)

  renderer = createVisualizerRenderer(canvas, bins)
  if (!renderer) {
    unsupported.value = true
    return
  }

  renderer.setPreset(props.preset)
  renderer.resize()
  timeScale = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? REDUCED_MOTION_TIME_SCALE
    : 1

  observer = new ResizeObserver(() => renderer?.resize())
  observer.observe(canvas)
  document.addEventListener('visibilitychange', onVisibilityChange)
  startLoop()
})

onBeforeUnmount(() => {
  stopLoop()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  observer?.disconnect()
  observer = null
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div class="absolute inset-0">
    <canvas ref="canvasRef" class="block size-full" aria-hidden="true" />
    <UiEmptyState
      v-if="unsupported"
      :icon="AudioLines"
      message="This browser can't run the visualizer"
      hint="WebGL is unavailable or blocked here."
      class="absolute inset-0 grid place-items-center"
    />
  </div>
</template>
