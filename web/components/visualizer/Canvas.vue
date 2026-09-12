<script setup lang="ts">
import { AudioLines } from 'lucide-vue-next'
import { createVisualizerRenderer } from '~/helpers/visualizer/renderer'
import { getBoundaryJuliaPath, juliaCAlongPath } from '~/helpers/visualizer/juliaPath'
import { lerpEased, lerpHue } from '~/helpers/visualizer/hueMorph'
import { pickJuliaTarget } from '~/helpers/visualizer/juliaField'
import { isBeat, rms, smoothTowards, splitBands } from '~/helpers/audioBands'
import type { VisualizerPresetId } from '~/helpers/constants'
import { usePlayerStore } from '~/stores/player'
import type { VisualizerRenderer } from '~/types/visualizer'

const props = defineProps<{ preset: VisualizerPresetId }>()

const player = usePlayerStore()
const { attach, resume, read } = useAudioAnalyser()

// Per-frame lerp factors. A rise is followed almost immediately so a kick lands on the beat; the
// fall is eased so the shape doesn't strobe between frames.
const BAND_ATTACK = 0.55
const BAND_RELEASE = 0.12
const LEVEL_ATTACK = 0.4
const LEVEL_RELEASE = 0.08
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
// rather than constant jitter. Flow and Julia's own (much smaller) uBass touches are
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

// Chaos's colour morphs explicitly between two hues, A to B, over a random duration - never an
// instant cut. The shader derives its whole anchor-chain palette off this one morphed hue, so the
// full palette blends to its next random variation in the same 5-9s window, per request.
const CHAOS_MORPH_MIN_S = 5
const CHAOS_MORPH_MAX_S = 9
const randomMorphDuration = () =>
  CHAOS_MORPH_MIN_S + Math.random() * (CHAOS_MORPH_MAX_S - CHAOS_MORPH_MIN_S)
// 3-5 anchors in the shared palette chain (helpers/visualizer/shaders.ts' chaosAnchor()) -
// re-rolled in step with the hue morph target, not continuously, since interpolating a fractional
// anchor count makes no sense; landing the change on the same boundary the colour itself already
// jumps to a new random variation at means it reads as "a new variation" rather than a glitch.
const randomAnchorCount = () => 3 + Math.floor(Math.random() * 3)

// Fractal's own Julia constant eases from one random point on Chaos's boundary path to another -
// the "seamlessly transitions to another fractal" behaviour - over a random 7-14s, the same
// A-to-B-morph idiom chaosHue uses just applied to a path phase instead of a hue.
const FRACTAL_MORPH_MIN_S = 7
const FRACTAL_MORPH_MAX_S = 14
const randomFractalMorphDuration = () =>
  FRACTAL_MORPH_MIN_S + Math.random() * (FRACTAL_MORPH_MAX_S - FRACTAL_MORPH_MIN_S)

// Julia's target (power + c, picked and validated by pickJuliaTarget() - see
// helpers/visualizer/juliaField.ts for why an unvalidated target could read as one flat colour
// filling the screen) holds still for a random 5-12s, then eases to a freshly-picked target over
// a few seconds - "let it flow freely, then move seamlessly to something new," no beat involved,
// just a timer.
const JULIA_POWER_MIN = 2.2
const JULIA_POWER_MAX = 6.0
const JULIA_HOLD_MIN_S = 5
const JULIA_HOLD_MAX_S = 12
const JULIA_TRANSITION_MIN_S = 2
const JULIA_TRANSITION_MAX_S = 4
const randomJuliaHold = () => JULIA_HOLD_MIN_S + Math.random() * (JULIA_HOLD_MAX_S - JULIA_HOLD_MIN_S)
const randomJuliaTransition = () =>
  JULIA_TRANSITION_MIN_S + Math.random() * (JULIA_TRANSITION_MAX_S - JULIA_TRANSITION_MIN_S)
const randomJuliaTarget = () => pickJuliaTarget(JULIA_POWER_MIN, JULIA_POWER_MAX)

// Flow's warp-seed offset orbits the origin slowly and continuously - deliberately NOT a
// hold-then-jump reroll (an earlier version held it still for 20-40s then eased to a fresh random
// point every time, which read as "static for a while, then a fast jarring slide to a different
// scene" - exactly the failure Buddhabrot's own sampled-region comment already warned about, see
// BUDDHABROT_SWEEP's history in git blame). A slow perpetual orbit has no jumps at all, so there is
// nothing to read as a sudden scene change - just an endlessly, gradually exploring path through
// the noise field. Radius is arbitrary but large relative to the fbm's own coordinate scale, so the
// orbit actually visits different-looking neighbourhoods rather than barely-different ones; period
// ~650s (4x an earlier version's speed, per request) - still slow relative to the swirl/zoom in
// helpers/visualizer/shaders.ts's FLOW, since this is background motion, not something meant to be
// tracked frame to frame.
const FLOW_SEED_RADIUS = 30
const FLOW_SEED_SPEED = 0.0096

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
let bassBaseline = 0
// Starts already "due" (0), so the very first beat of the session triggers a jump immediately
// instead of waiting out a full freeze window with a stale zero.
let fractalFreezeUntil = 0
let fractalFrozenBass = 0
// Chaos's own hue morph state: ease from chaosHueFrom to chaosHueTo, starting at chaosMorphStart,
// over chaosMorphDuration seconds. Initialised already "mid-flight" (from a random point, towards
// another) rather than pinned to a fixed starting hue - opening the overlay should never look the
// same twice.
let chaosHueFrom = Math.random()
let chaosHueTo = Math.random()
let chaosMorphStart = 0
let chaosMorphDuration = randomMorphDuration()
let chaosAnchors = randomAnchorCount()
// Fractal's own path-phase morph state - identical shape to chaosHueFrom/To above, just walking
// Chaos's boundary path (juliaCAlongPath) instead of the hue wheel.
let fractalFromT = Math.random()
let fractalToT = Math.random()
let fractalMorphStart = 0
let fractalMorphDuration = randomFractalMorphDuration()
// Julia's target morph state: holds at `to` until juliaHoldUntil, then eases from `to` (the new
// `from`) to a freshly-picked target over juliaTransitionDuration seconds. Starts already
// "arrived" at a validated target rather than mid-flight - unlike the free-running presets, a bad
// starting frame here is the literal bug being fixed, so this never picks two different targets
// for the very first frame.
let juliaFrom = randomJuliaTarget()
let juliaTo = juliaFrom
let juliaMorphStart = 0
let juliaTransitionDuration = randomJuliaTransition()
let juliaHoldUntil = randomJuliaHold()

let timeScale = 1

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
    chaosAnchors = randomAnchorCount()
  }

  // getBoundaryJuliaPath() builds its (smoothed, always-outside) path once and caches it - this is
  // a cheap array lookup every frame after that, never a live per-frame search. Walking a
  // precomputed path rather than calling the search directly is what makes shape changes morph
  // continuously instead of jump-cutting: the raw search's own bisection can legitimately land on
  // unrelated points for barely-different inputs (the escape-time landscape right at the
  // Mandelbrot boundary is itself discontinuous), and a Julia set is sensitive enough to c that
  // even a small jump there reads as the entire fractal jumping. Both Chaos (continuous sweep) and
  // Fractal (eased A-to-B, below) walk the same cached path.
  const juliaPath = getBoundaryJuliaPath()

  // Ease Fractal's own Julia constant from fractalFromT to fractalToT; once that arc completes, the
  // arrival phase becomes the new departure point and a fresh random target/duration are picked -
  // the same unbroken A-to-B chain chaosHue uses above.
  const fractalMorphT = (clock - fractalMorphStart) / fractalMorphDuration
  const fractalC = juliaCAlongPath(juliaPath, lerpHue(fractalFromT, fractalToT, fractalMorphT))
  if (fractalMorphT >= 1) {
    fractalFromT = fractalToT
    fractalToT = Math.random()
    fractalMorphStart = clock
    fractalMorphDuration = randomFractalMorphDuration()
  }

  // Julia: hold at the current target until juliaHoldUntil, then pick a fresh validated one and
  // ease into it over juliaTransitionDuration - no beat involved, just the interval timer. Once
  // fired, the interpolation itself uses the same lerpEased() A-to-B idiom as everything else
  // (its own clamping is what makes the value hold steady at `to` for the rest of the interval,
  // without a separate "are we still transitioning" flag).
  if (clock >= juliaHoldUntil) {
    juliaFrom = juliaTo
    juliaTo = randomJuliaTarget()
    juliaMorphStart = clock
    juliaTransitionDuration = randomJuliaTransition()
    juliaHoldUntil = clock + juliaTransitionDuration + randomJuliaHold()
  }
  const juliaT = (clock - juliaMorphStart) / juliaTransitionDuration
  const juliaPower = lerpEased(juliaFrom.power, juliaTo.power, juliaT)
  const juliaSetC: readonly [number, number] = [
    lerpEased(juliaFrom.cx, juliaTo.cx, juliaT),
    lerpEased(juliaFrom.cy, juliaTo.cy, juliaT),
  ]

  // Flow: a slow continuous orbit through noise-space, never a jump - see FLOW_SEED_SPEED's comment.
  const flowSeed: readonly [number, number] = [
    Math.cos(clock * FLOW_SEED_SPEED) * FLOW_SEED_RADIUS,
    Math.sin(clock * FLOW_SEED_SPEED) * FLOW_SEED_RADIUS,
  ]

  renderer.draw({
    time: clock,
    // Every other preset gets the live envelope; Fractal (the only uBass consumer - see the
    // comment on FRACTAL_FREEZE_MIN_S above) gets the gated value instead.
    bass: props.preset === 'fractal' ? fractalFrozenBass : bass,
    mid,
    treble,
    level,
    chaosHue,
    chaosAnchors,
    fractalC,
    juliaPower,
    juliaSetC,
    flowSeed,
    juliaC: juliaCAlongPath(juliaPath, clock * JULIA_SWEEP),
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
  chaosHueFrom = Math.random()
  chaosHueTo = Math.random()
  chaosMorphStart = clock
  chaosMorphDuration = randomMorphDuration()
  chaosAnchors = randomAnchorCount()
  fractalFromT = Math.random()
  fractalToT = Math.random()
  fractalMorphStart = clock
  fractalMorphDuration = randomFractalMorphDuration()
  juliaFrom = randomJuliaTarget()
  juliaTo = juliaFrom
  juliaMorphStart = clock
  juliaTransitionDuration = randomJuliaTransition()
  juliaHoldUntil = clock + randomJuliaHold()
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

  renderer = createVisualizerRenderer(canvas)
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
