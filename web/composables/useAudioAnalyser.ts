import { VISUALIZER_FFT_SIZE } from '~/helpers/constants'

// The Web Audio tap on the player's single HTMLAudioElement (stores/player.ts holds one lazily
// created `new Audio()` and exposes it via getAudioElement()).
//
// Module-level singletons, not per-call state, because createMediaElementSource() may be called
// exactly ONCE per element for the life of the page - a second call throws InvalidStateError. Once
// called, the element's output routes through this graph, so the source MUST stay connected to
// ctx.destination or playback goes silent app-wide. That is also why there is no dispose(): the
// graph is built on first visualizer open and then left alone forever. A user who never opens the
// visualizer keeps the untouched plain-element playback path.
let ctx: AudioContext | null = null
let source: MediaElementAudioSourceNode | null = null
let analyser: AnalyserNode | null = null
let freq: Uint8Array<ArrayBuffer> | null = null
let time: Uint8Array<ArrayBuffer> | null = null

export const useAudioAnalyser = () => {
  /**
   * Wire `el` into the analyser graph. Idempotent and safe to call on every overlay open; returns
   * false when Web Audio is unavailable or the element was already claimed by something else, in
   * which case the visualizer renders its silent idle state rather than breaking playback.
   */
  const attach = (el: HTMLAudioElement | null): boolean => {
    if (analyser) {
      return true
    }
    if (!el || !import.meta.client) {
      return false
    }
    const AudioContextCtor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      return false
    }
    try {
      ctx = new AudioContextCtor()
      source = ctx.createMediaElementSource(el)
      analyser = ctx.createAnalyser()
      analyser.fftSize = VISUALIZER_FFT_SIZE
      // Smoothing is done on our side (helpers/audioBands.ts smoothTowards) with separate attack
      // and release, which reads far better than the analyser's single symmetric constant.
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      analyser.connect(ctx.destination)
      freq = new Uint8Array(analyser.frequencyBinCount)
      // Deliberately binCount, not fftSize: getByteTimeDomainData fills min(array.length, fftSize),
      // so a half-window is a perfectly good scope trace - and it keeps all three visualizer
      // textures the same width, which is what the renderer allocates them at.
      time = new Uint8Array(analyser.frequencyBinCount)
      return true
    }
    catch (error) {
      console.error('Visualizer could not tap the audio element:', error)
      ctx = null
      source = null
      analyser = null
      return false
    }
  }

  // An AudioContext is created suspended and only a user gesture may start it. Every caller here
  // is inside a click handler, so this is the moment that gesture is spent.
  const resume = () => {
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => { /* autoplay policy - the next gesture gets another chance */ })
    }
  }

  // Returns the same two arrays every frame, refilled in place: at 60fps a fresh pair would be
  // 120 short-lived allocations a second for no benefit.
  const read = (): { freq: Uint8Array<ArrayBuffer>, time: Uint8Array<ArrayBuffer> } | null => {
    if (!analyser || !freq || !time) {
      return null
    }
    analyser.getByteFrequencyData(freq)
    analyser.getByteTimeDomainData(time)
    return { freq, time }
  }

  const binCount = (): number => analyser?.frequencyBinCount ?? VISUALIZER_FFT_SIZE / 2

  return { attach, resume, read, binCount }
}
