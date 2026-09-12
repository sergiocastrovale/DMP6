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
  // as jumping. Read by Chaos, Fractal, Julia and Flow, which all share one drifting palette so
  // switching between presets stays visually continuous.
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
  // Flow's warp-seed offset (helpers/visualizer/shaders.ts's FLOW): an extra additive term folded
  // into the fbm's coordinate space, slowly orbiting the origin every frame (Canvas.vue) so the
  // plasma keeps exploring new neighbourhoods. Deliberately a continuous orbit, never a
  // hold-then-jump reroll - see Canvas.vue's FLOW_SEED_SPEED comment for why a jump reads as a
  // seizure-inducing scene change.
  flowSeed: readonly [number, number]
}

export interface VisualizerRenderer {
  setPreset: (preset: VisualizerPresetId) => void
  resize: () => void
  draw: (frame: VisualizerFrame) => void
  dispose: () => void
}
