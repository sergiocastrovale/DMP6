import type { VisualizerPresetId } from '~/helpers/constants'

// Frequency energy split into the three bands a visualizer actually reacts to. Each 0-1, already
// smoothed by the render loop before it reaches a shader.
export interface AudioBands {
  bass: number
  mid: number
  treble: number
}

// One frame's worth of audio state handed to the renderer. The three byte arrays are uploaded as
// 1D textures so a shader can read whole curves rather than just the three scalar bands: `spectrum`
// is the raw FFT, `waveform` the time domain (for the oscilloscope), `peaks` the decaying
// per-bin maxima that draw a bar visualizer's peak caps.
export interface VisualizerFrame extends AudioBands {
  time: number
  level: number
  // Accent hue in HSV degrees - what Spectrum's `accent()` reads.
  hue: number
  // 0-1, re-rolled whenever the overlay opens or the preset changes - what Fractal/Tunnel's
  // `freeColor()` reads instead of `hue`, since their palette is deliberately decoupled from the
  // accent theme (see helpers/visualizer/shaders.ts).
  colorSeed: number
  // The Chaos preset's Julia constant, picked on the CPU each frame because it needs a search and
  // is the same for every pixel - see helpers/visualizer/juliaPath.ts.
  juliaC: readonly [number, number]
  // Chaos's own hue (0-1), separate from colorSeed: a CPU-side eased A-to-B morph
  // (helpers/visualizer/hueMorph.ts) rather than a formula the shader evolves on its own, because
  // Chaos's shape moves fast enough that the shared freeColor() drift read as jumping.
  chaosHue: number
  spectrum: Uint8Array
  waveform: Uint8Array
  peaks: Uint8Array
}

export interface VisualizerRenderer {
  setPreset: (preset: VisualizerPresetId) => void
  resize: () => void
  draw: (frame: VisualizerFrame) => void
  dispose: () => void
}
