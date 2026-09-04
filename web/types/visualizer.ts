import type { VisualizerPresetId } from '~/helpers/constants'

// Frequency energy split into the three bands a visualizer actually reacts to. Each 0-1, already
// smoothed by the render loop before it reaches a shader.
export interface AudioBands {
  bass: number
  mid: number
  treble: number
}

// One frame's worth of state handed to the renderer.
export interface VisualizerFrame extends AudioBands {
  time: number
  level: number
  // The Chaos preset's Julia constant, picked on the CPU each frame because it needs a search and
  // is the same for every pixel - see helpers/visualizer/juliaPath.ts.
  juliaC: readonly [number, number]
  // The shared "N contrasting anchors" palette state (helpers/visualizer/shaders.ts' chaosAnchor())
  // - a CPU-side eased A-to-B morph (helpers/visualizer/hueMorph.ts) rather than a formula the
  // shader evolves on its own, because Chaos's shape moves fast enough that a continuous drift read
  // as jumping. Read by Chaos, Fractal, Julia and Buddhabrot's present pass, which all share one
  // drifting palette so switching between presets stays visually continuous.
  chaosHue: number
  // How many anchors (3-5) the shared palette chain has this cycle - re-rolled alongside chaosHue's
  // target, not every frame, so the anchor count only ever changes at the same 5-9s boundary the
  // colour itself moves to a new random variation.
  chaosAnchors: number
  // Fractal's current Julia constant: eased between two random points on Chaos's own boundary path
  // (helpers/visualizer/juliaPath.ts) over a random 7-14s window (Canvas.vue) - the "seamlessly
  // transitions to another fractal" shape change, independent of Chaos's own continuous sweep.
  fractalC: readonly [number, number]
  // Julia's drifting power n (z <- z^n + c) - eased between two random, VALIDATED targets in
  // Canvas.vue (helpers/visualizer/juliaField.ts's pickJuliaTarget() - picking blind is what
  // produced the "one flat colour fills the screen" bug) with the same A-to-B idiom as
  // chaosHue/fractalC, just over a plain (non-circular) range - lerpEased(), not lerpHue().
  juliaPower: number
  // Julia's own picked-and-validated constant, eased in lockstep with juliaPower between the same
  // two targets - see pickJuliaTarget() and helpers/visualizer/shaders.ts's JULIA preset.
  juliaSetC: readonly [number, number]
  // Buddhabrot's seed pool: `[cx, cy]` pairs, every one of them PROVEN on the CPU to escape within
  // SEED_MAX_ITER (helpers/visualizer/buddhabrotMath.ts's generateSeedPool). The GPU reseeds a
  // sample by picking from this pool and nothing else - that guarantee is what makes plotting an
  // orbit as it iterates equivalent to the canonical "test first, then replay and plot" algorithm.
  // The sampled region these are drawn from drifts continuously every frame (Canvas.vue's
  // BUDDHABROT_SWEEP, the same idiom as Chaos's own uJuliaC), so the pool is refilled a slice at a
  // time too - both to keep the cost off any single frame and to keep tracking the moving region.
  buddhabrotSeeds: Float32Array
  // Buddhabrot's OWN anchor count (6-10), separate from chaosAnchors' shared 3-5 - its density
  // spans void -> halo -> filament -> hot core in one image, more range than the other three
  // presets each show at once, so it was given room for more distinct colours rather than widening
  // the shared range those three are tuned against. Still rides the same uChaosHue drift for
  // continuity when switching presets - see helpers/visualizer/buddhabrot.ts's present pass.
  buddhabrotAnchors: number
}

export interface VisualizerRenderer {
  setPreset: (preset: VisualizerPresetId) => void
  resize: () => void
  draw: (frame: VisualizerFrame) => void
  dispose: () => void
}
