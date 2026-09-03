// Plain-TS WebGL layer for the visualizer: no Vue, no store, no DOM beyond the canvas it is handed.
// Everything reactive lives in components/visualizer/Canvas.vue, which owns the rAF loop and calls
// draw() with a frame; this file only knows how to put that frame on screen.

import { FRAGMENT_SHADERS, VERTEX_SHADER } from '~/helpers/visualizer/shaders'
import type { VisualizerPresetId } from '~/helpers/constants'
import type { VisualizerFrame, VisualizerRenderer } from '~/types/visualizer'

// Retina at 4K is 33M fragments a frame for shaders this heavy. Capping the backing store at 1.5x
// CSS pixels keeps the fractal preset at 60fps on an integrated GPU and is visually indistinguishable
// on a canvas with no text or hard edges on it.
const MAX_PIXEL_RATIO = 1.5

const UNIFORM_NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uLevel', 'uHue', 'uSeed', 'uJuliaC',
  'uChaosHue', 'uSpectrum', 'uWaveform', 'uPeaks',
] as const

type UniformName = (typeof UNIFORM_NAMES)[number]

interface CompiledProgram {
  program: WebGLProgram
  uniforms: Partial<Record<UniformName, WebGLUniformLocation | null>>
}

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Visualizer shader failed to compile:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const linkProgram = (gl: WebGLRenderingContext, fragment: string): CompiledProgram | null => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
  if (!vs || !fs) {
    return null
  }
  const program = gl.createProgram()
  if (!program) {
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  // The shader objects are reference-counted by the program once attached, so they can go now.
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Visualizer program failed to link:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  const uniforms: CompiledProgram['uniforms'] = {}
  for (const name of UNIFORM_NAMES) {
    uniforms[name] = gl.getUniformLocation(program, name)
  }
  return { program, uniforms }
}

// LUMINANCE rather than R8: it is an unsized format valid in both WebGL1 and WebGL2, so the two
// context paths upload identically and the shader reads `.r` either way.
const createDataTexture = (gl: WebGLRenderingContext, length: number): WebGLTexture | null => {
  const texture = gl.createTexture()
  if (!texture) {
    return null
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, length, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

/**
 * Build a renderer for `canvas`, or null when WebGL is unavailable (blocked, software-rendering
 * disabled, an old browser). Callers must handle null - the overlay shows a fallback message
 * rather than an unexplained black screen.
 */
export const createVisualizerRenderer = (canvas: HTMLCanvasElement, spectrumLength: number): VisualizerRenderer | null => {
  const gl = (canvas.getContext('webgl2', { antialias: false, alpha: false })
    ?? canvas.getContext('webgl', { antialias: false, alpha: false })) as WebGLRenderingContext | null
  if (!gl) {
    return null
  }

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const spectrumTexture = createDataTexture(gl, spectrumLength)
  const waveformTexture = createDataTexture(gl, spectrumLength)
  const peaksTexture = createDataTexture(gl, spectrumLength)

  // Compiled on demand and kept: switching presets mid-track must not stall on a fresh compile
  // every time the user cycles back to one they already looked at.
  const programs = new Map<VisualizerPresetId, CompiledProgram | null>()
  let current: CompiledProgram | null = null

  const setPreset = (preset: VisualizerPresetId) => {
    if (!programs.has(preset)) {
      programs.set(preset, linkProgram(gl, FRAGMENT_SHADERS[preset]))
    }
    current = programs.get(preset) ?? null
    if (!current) {
      return
    }
    gl.useProgram(current.program)
    const position = gl.getAttribLocation(current.program, 'aPosition')
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(current.uniforms.uSpectrum ?? null, 0)
    gl.uniform1i(current.uniforms.uWaveform ?? null, 1)
    gl.uniform1i(current.uniforms.uPeaks ?? null, 2)
  }

  const resize = () => {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
    if (canvas.width === width && canvas.height === height) {
      return
    }
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }

  const uploadTexture = (unit: number, texture: WebGLTexture | null, data: Uint8Array) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, data.length, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, data)
  }

  const draw = (frame: VisualizerFrame) => {
    if (!current) {
      return
    }
    gl.useProgram(current.program)
    uploadTexture(0, spectrumTexture, frame.spectrum)
    uploadTexture(1, waveformTexture, frame.waveform)
    uploadTexture(2, peaksTexture, frame.peaks)

    const u = current.uniforms
    gl.uniform2f(u.uResolution ?? null, canvas.width, canvas.height)
    gl.uniform1f(u.uTime ?? null, frame.time)
    gl.uniform1f(u.uBass ?? null, frame.bass)
    gl.uniform1f(u.uMid ?? null, frame.mid)
    gl.uniform1f(u.uTreble ?? null, frame.treble)
    gl.uniform1f(u.uLevel ?? null, frame.level)
    gl.uniform1f(u.uHue ?? null, frame.hue)
    gl.uniform1f(u.uSeed ?? null, frame.colorSeed)
    gl.uniform2f(u.uJuliaC ?? null, frame.juliaC[0], frame.juliaC[1])
    gl.uniform1f(u.uChaosHue ?? null, frame.chaosHue)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const dispose = () => {
    for (const compiled of programs.values()) {
      if (compiled) {
        gl.deleteProgram(compiled.program)
      }
    }
    programs.clear()
    current = null
    gl.deleteBuffer(quad)
    gl.deleteTexture(spectrumTexture)
    gl.deleteTexture(waveformTexture)
    gl.deleteTexture(peaksTexture)
    // Browsers cap how many live WebGL contexts a page may hold, and the overlay is opened and
    // closed repeatedly - dropping the context explicitly keeps that budget from running out.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  return { setPreset, resize, draw, dispose }
}
