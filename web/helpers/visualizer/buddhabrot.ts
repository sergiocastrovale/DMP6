// GPU-accumulated Buddhabrot: a histogram of ESCAPING Mandelbrot orbits' trajectories, built up
// over many frames. This is a genuinely different rendering shape from every other preset in
// helpers/visualizer/shaders.ts - a single fragment shader can't compute it, since it isn't a
// function of a pixel's own position, it's a function of everywhere every sampled orbit happened
// to pass through. So this module owns its own framebuffers, blend state and small GL programs,
// and helpers/visualizer/renderer.ts only ever calls the four functions this file exports - it
// never reaches into GL state here directly.
//
// THE ALGORITHM, and the one property everything here rests on. Canonically a Buddhabrot is:
//
//   for many random c:
//     z = 0; iterate z <- z² + c up to maxIter          # PASS 1 - TEST, plot nothing
//     if it escaped (|z| > 2):                          # PASS 2 - REPLAY, plot every step
//       z = 0; iterate again, plotting each z
//
// Nothing may be plotted until the orbit is KNOWN to escape. Interior orbits must contribute
// exactly zero - that is what leaves the set's interior a void and produces the hollow silhouette.
// An earlier version of this file ran the test on the GPU inside the reseed (a 50-iteration
// Mandelbrot-membership check) and plotted orbits as they iterated regardless. 50 iterations does
// not remotely resolve a near-boundary c, which is exactly what reseeding draws, so interior and
// near-periodic orbits were admitted constantly; each then splatted for its whole ~400-frame
// lifetime, depositing density precisely where the image has to stay black. That is the
// anti-Buddhabrot filling in the void, and it rendered as an opaque cloud with no structure at all.
// No exposure, palette or decay tuning can undo it - by then the wrong points are already in the
// buffer.
//
// The fix is to move the test to where it can be done properly: seeds arrive pre-verified from the
// CPU (helpers/visualizer/buddhabrotMath.ts's generateSeedPool, via VisualizerFrame.buddhabrotSeeds)
// having been iterated to SEED_MAX_ITER, and are quantised to the GPU's own encoding BEFORE being
// verified, so the value proven to escape is the value the GPU actually iterates. Because every
// live c provably escapes, plotting each orbit as it iterates is mathematically identical to the
// canonical replay pass - the test pass simply already happened, on the CPU, once per seed instead
// of once per frame. Escape is then the only thing that ends an orbit; the reseed timer that used
// to be the primary terminator survives only as SAFETY_RESEED_PROB, a backstop against fixed-point
// drift.
//
// Per frame:
//  1. ADVANCE - one z <- z² + c step for every live sample, read from and written to a ping-ponged
//     pair of state textures (z and c each get their own - see "why two textures" below). On escape
//     the texel reseeds: z to the origin, c to a fresh pool entry. O(live samples) per frame, NOT
//     O(samples x orbit length) - the "vertex re-iterates its whole orbit every frame" scheme was
//     rejected for that quadratic blowup, so here orbit length is free.
//  2. SPLAT - one `gl.POINTS` vertex per state texel, each decoding its freshly-advanced z and
//     adding it to a canvas-proportioned accumulation texture with ADDITIVE blending. Drawn twice,
//     the second time mirrored in the real axis: a Buddhabrot is symmetric about it, so the
//     conjugate of every orbit is a free doubling of the effective sample count.
//  3. DECAY - a fullscreen pass multiplying the accumulation buffer by a fixed sub-1 factor every
//     frame. Always on, not a fallback step - see DECAY_HALF_LIFE_S's own comment.
//  4. PRESENT - log-tonemap the accumulation texture and run it through the same chaosMix() palette
//     Chaos/Fractal/Julia use, into the default framebuffer.
//
// MOTION. The sampled region Canvas.vue draws seeds from walks Chaos's own boundary path
// continuously, every frame (BUDDHABROT_SWEEP there) - the same idiom as Chaos's own uJuliaC -
// rather than holding still for a long stretch and jumping. A held-then-jump region, with the
// accumulation integrating with NO decay at all so detail could keep sharpening indefinitely, was
// the original design and was explicitly rejected: once a histogram is a few seconds old it barely
// changes frame to frame, so the whole preset read as a slideshow of static photographs with an
// occasional pop to a new one, not something ALIVE the way Chaos's continuously-morphing dendrite
// is. DECAY_HALF_LIFE_S is short specifically so the accumulated image can actually follow that
// continuous drift instead of blurring into an average of everywhere it has ever pointed.
//
// ACCUMULATION FORMAT. The reference renders span orders of magnitude between the hot core and the
// faint filaments that carry all the detail, and RGBA8 holds 256 levels; a per-frame decay on top
// of that pins every pixel to a steady state proportional to its hit rate, compressing the range
// into a handful of levels and reading as flat mush. Where WebGL2 + EXT_color_buffer_float allow
// it, this accumulates into RGBA32F/16F instead, which holds enough range that the same short decay
// still resolves real filament detail rather than banding. The RGBA8 + 16-bit-fixed-point path is
// kept as a complete fallback - it cannot look as sharp as the references, but it does render.
//
// Why TWO state textures, not one packing z and c into a single texel: on the fallback path an
// 8-bit-per-component encoding would give z only 256 possible values per axis, so every plotted
// point could only land on one of 256 columns and rows - a visible lattice rather than organic
// dust. z is packed at 16 bits per axis (two 8-bit channels, encode16()/decode16()) across all four
// channels of its own texture, and c gets the same treatment in a second one. Two textures means
// two advance passes rather than one, since a fragment shader can only write one render target
// without MRT (an extension this module deliberately doesn't require) - both recompute the
// identical escape/reseed decision from identical inputs, which is why those lines are duplicated
// textually rather than shared: two separately linked programs calling "the same" function is still
// two copies as far as a driver is concerned.
//
// Blend/framebuffer/viewport state hygiene: renderer.ts never touches blend state, gl.clear, or any
// framebuffer but the default one for any other preset - they all just draw one fullscreen triangle
// with blending implicitly off. This module is the ONLY thing in the app that turns blending on, so
// draw() below MUST leave blending disabled, the default framebuffer bound, and the full-canvas
// viewport restored before it returns, every call - there is no other place that resets this state.

import type { VisualizerFrame } from '~/types/visualizer'
import { PRELUDE, VERTEX_SHADER } from '~/helpers/visualizer/shaders'
import {
  SEED_POOL_CAPACITY,
  accumulationSize,
  buildStateUvGrid,
  estimateNormalisation,
  halfLifeToDecayFactor,
  projectionScale,
  stateLevel,
} from '~/helpers/visualizer/buddhabrotMath'

// State texture resolution cap - the live sample budget (36,864 concurrent orbits at 192x192).
// Sets per-frame GPU cost (advance and splat are both O(this)); ACCUM_CAP sets image resolution.
// Deliberately different knobs.
const STATE_CAP = 192
// The accumulation texture's resolution cap (long edge) - near 1:1 with most canvases, since a
// fixed sample budget spread over fewer texels reads denser and less noisy.
const ACCUM_CAP = 1920
// Backstop ONLY. Escape is what ends an orbit now that every seed is CPU-verified to escape; this
// exists solely because the fallback path's 16-bit z quantisation perturbs the trajectory slightly,
// and a perturbed orbit could in principle miss its escape and sit forever. One reseed per ~900
// frames per texel is far too rare to bias the histogram, and caps the damage at ~15 seconds.
const SAFETY_RESEED_PROB = 1 / 900
// Frames over which the state texels take their first seed (see `born` in ADVANCE_STEP_GLSL). Two
// seconds at 60fps - long enough for the CPU pool to reach capacity at BUDDHABROT_SEEDS_PER_FRAME,
// short enough that the image is fully populated almost immediately.
const BIRTH_SPREAD_FRAMES = 120
// Density added per splatted point. On the float path this is a literal hit count; on the RGBA8
// fallback it has to stay small enough that the decayed steady state doesn't saturate at 1.0.
const FLOAT_DENSITY_INCREMENT = 1
const BYTE_DENSITY_INCREMENT = 0.0035
// A SHORT half-life, always active (not fallback-only) - this is what gives Buddhabrot continuous
// motion instead of a photograph that stops changing once converged. Canvas.vue walks the sampled
// region continuously along Chaos's own boundary path every frame (BUDDHABROT_SWEEP), the same way
// Chaos's own `c` continuously drifts - decay is what lets the accumulated image actually FOLLOW
// that drift instead of a slowly-growing average of every region it has ever passed through. Short
// enough that the image keeps visibly churning (like Chaos's dendrite reads as alive every frame),
// long enough that a single frame's sparse splats still read as a coherent shape rather than noise.
const DECAY_HALF_LIFE_S = 2.5
// Half-height of the view in complex-plane units - smaller crops in, larger zooms out. The full
// silhouette spans about ±1.3 on the imaginary axis, so 1.45 (the original value) framed the whole
// thing with a little air; 4x tighter deliberately overflows top/bottom/sides so the silhouette
// fills the frame instead of sitting centred with room around it, per request.
const VIEW_SCALE = 1.45 / 4
// Log-tonemap steepness, and the assumed hottest-pixel-to-mean density ratio the tonemap normalises
// against (see estimateNormalisation). Together these are the exposure: TONE_K sets how hard the
// faint filaments are lifted, PEAK_OVER_MEAN how much headroom the core keeps before clipping flat.
// PEAK_OVER_MEAN was tuned at 90 for the old monotonic-integration design, where the hottest pixel
// could end up dramatically above the mean after minutes of never-decaying convergence. With decay
// now always on and short (DECAY_HALF_LIFE_S), the buffer sits in a fast-moving steady state instead
// - the real peak/mean ratio there is far smaller, so normalising against 90 divided every pixel by
// a headroom that mostly never gets used, which is what read as a faint haze of dust instead of a
// bold shape. Cut 5x per request.
const TONE_K = 400
const PEAK_OVER_MEAN = 18

// Sized internal formats as raw enum values: `gl` is typed as WebGLRenderingContext (renderer.ts
// hands us whichever context it got), so gl.RGBA32F isn't on the type even when the context is
// really a WebGL2 one that accepts it.
const GL_RGBA32F = 0x8814
const GL_RGBA16F = 0x881A
const GL_HALF_FLOAT = 0x140B

interface CompiledProgram {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
  // Every program here has exactly one vertex attribute (aPosition for the fullscreen-triangle
  // passes, aUv for the splat pass) - a single cached location rather than a map, so callers never
  // touch an unchecked string key.
  attribute: number
}

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Buddhabrot shader failed to compile:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const linkProgram = (
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: readonly string[],
  attributeName: string,
): CompiledProgram | null => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
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
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Buddhabrot program failed to link:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, name)
  }
  return { program, uniforms, attribute: gl.getAttribLocation(program, attributeName) }
}

interface FloatSupport {
  // Float STATE textures (the orbit itself). Needs only render-to-float; these are sampled NEAREST
  // and never blended, so no other extension applies.
  state: boolean
  // Float ACCUMULATION. Blending into a 32-bit float target additionally needs EXT_float_blend -
  // without it the splat pass's additive draw is an INVALID_OPERATION and nothing accumulates at
  // all. RGBA16F is blendable under plain EXT_color_buffer_float, so it is the middle tier: less
  // headroom (its mantissa stops resolving +1 somewhere past a few thousand hits) but still vastly
  // more range than 8 bits.
  accum: 'float32' | 'float16' | 'byte'
  // Filtering a 32-bit float texture needs OES_texture_float_linear; without it a LINEAR-filtered
  // RGBA32F texture is INCOMPLETE and samples as pure black. RGBA16F is filterable in WebGL2 core.
  accumFilterLinear: boolean
}

const detectFloatSupport = (gl: WebGLRenderingContext): FloatSupport => {
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
  if (!isWebGL2 || !gl.getExtension('EXT_color_buffer_float')) {
    return { state: false, accum: 'byte', accumFilterLinear: false }
  }
  const canBlendFloat32 = gl.getExtension('EXT_float_blend') !== null
  return {
    state: true,
    accum: canBlendFloat32 ? 'float32' : 'float16',
    accumFilterLinear: canBlendFloat32 ? gl.getExtension('OES_texture_float_linear') !== null : true,
  }
}

// 16-bit fixed point across two 8-bit channels, range [-4, 4]. helpers/visualizer/buddhabrotMath.ts's
// quantizeStateValue() is the exact JS mirror of this round-trip, and seeds are snapped through it
// before they are verified - so a seed proven to escape is proven as the value this decodes to.
const CODEC_BYTES = `
vec2 encode16(float v) {
  // Integer t FIRST, then split - hi and lo are then both genuine integers in [0, 255], which makes
  // dividing by 255.0 an exact byte<->float round-trip through an UNSIGNED_BYTE channel. Splitting
  // an un-floored t lets the low remainder reach just under 256 and over-saturate to 1.0 on write.
  // The + 0.5 makes this ROUND to the nearest level rather than floor, matching stateLevel() in
  // buddhabrotMath.ts: a value that is already on the grid (every seed decoded from the pool is)
  // must re-encode to the same level it decoded from, and flooring its float32 representation
  // lands one step low about half the time.
  float t = floor(clamp((v + 4.0) / 8.0, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(t / 256.0);
  float lo = t - hi * 256.0;
  return vec2(hi, lo) / 255.0;
}
float decode16(vec2 hilo) {
  float t = hilo.x * 255.0 * 256.0 + hilo.y * 255.0;
  return t / 65535.0 * 8.0 - 4.0;
}
vec4 encodeVec2(vec2 v) {
  return vec4(encode16(v.x), encode16(v.y));
}
vec2 decodeVec2(vec4 p) {
  return vec2(decode16(p.rg), decode16(p.ba));
}
`

// The float path stores the orbit state directly - no packing, no quantisation, so a CPU-verified
// escaping orbit iterates on the GPU exactly as it did during verification.
const CODEC_FLOAT = `
vec4 encodeVec2(vec2 v) {
  return vec4(v, 0.0, 1.0);
}
vec2 decodeVec2(vec4 p) {
  return p.xy;
}
`

// Shared by both advance passes. uNoise is a per-texel CPU-random texture (Math.random(), built in
// allocate()) rather than a GPU hash of uv: hash(uv) is fract(sin(dot(...))) and uv here is a
// perfectly regular grid, which on real hardware retains visible periodicity from sin()'s limited
// range reduction - that produced a persistent rectilinear grid in the density field. Combining a
// per-texel random with the frame counter via fract() is a Cranley-Patterson rotation: every texel
// walks the same low-discrepancy sequence from its own random phase, with no GPU trig anywhere.
const ADVANCE_UNIFORMS_GLSL = `
uniform sampler2D uZState;
uniform sampler2D uCState;
uniform sampler2D uNoise;
uniform sampler2D uSeedPool;
uniform float uSeedCount;
uniform vec2 uStateResolution;
uniform float uFrame;
uniform float uReseedProb;
uniform float uBirthSpread;

// A fresh, already-proven-to-escape constant. All the work behind this line happened on the CPU -
// see the module header.
vec2 pickSeed(vec4 noiseSample, float frameJitter) {
  float index = floor(fract(noiseSample.b + frameJitter * 7.13) * uSeedCount);
  return decodeVec2(texture2D(uSeedPool, vec2((index + 0.5) / max(uSeedCount, 1.0), 0.5)));
}
`

// The escape test and reseed roll, identical in both advance passes because they must land on the
// same verdict from the same inputs - see the module header on why this is duplicated textually.
const ADVANCE_STEP_GLSL = `
  vec2 uv = gl_FragCoord.xy / uStateResolution;
  vec2 z = decodeVec2(texture2D(uZState, uv));
  vec2 c = decodeVec2(texture2D(uCState, uv));
  vec4 noiseSample = texture2D(uNoise, uv);

  vec2 newZ = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  // |z| > 2 - the canonical Mandelbrot bailout. Once past it the orbit is gone for good, so this is
  // both the escape test and the end of this orbit's contribution.
  bool escaped = dot(newZ, newZ) > 4.0;
  // fract(uFrame * φ⁻¹): a low-discrepancy sequence off an incrementing integer that needs no sin()
  // and stays exact in float32 for ~16 million frames (about 77 hours at 60fps).
  float frameJitter = fract(uFrame * 0.6180339887);
  bool expired = fract(noiseSample.a + frameJitter) < uReseedProb;
  bool reseeding = escaped || expired;
  // Every texel starts outside the escape radius, so without this they would ALL take their first
  // seed on frame 1 - tens of thousands of samples drawing only the few hundred distinct orbits the
  // pool has managed to verify by then, each at ~70x weight, for the whole 40-2000 frame length of
  // those orbits. Against a histogram that never decays that lopsided start would stay burned in
  // for the rest of the render. Staggering each texel's first seed over uBirthSpread frames by its
  // own fixed random offset spreads the demand out over the same window the pool needs to fill.
  bool born = uFrame > noiseSample.r * uBirthSpread;
`

const ADVANCE_Z_FRAGMENT = (codec: string): string => PRELUDE + codec + ADVANCE_UNIFORMS_GLSL + `
void main() {
` + ADVANCE_STEP_GLSL + `
  gl_FragColor = encodeVec2(reseeding ? vec2(0.0) : newZ);
}
`

// An unborn texel keeps its initial far-outside c, so it just re-escapes to z = 0 every frame -
// contributing nothing and plotting nothing - until its birth frame arrives.
const ADVANCE_C_FRAGMENT = (codec: string): string => PRELUDE + codec + ADVANCE_UNIFORMS_GLSL + `
void main() {
` + ADVANCE_STEP_GLSL + `
  gl_FragColor = encodeVec2(reseeding && born ? pickSeed(noiseSample, frameJitter) : c);
}
`

// One vertex per state texel, placing a point at this frame's freshly-advanced z. uProjection is
// the aspect-preserving scale from buddhabrotMath.ts's projectionScale() - dividing both axes by
// the same constant (what this used to do) stretches the plane by the canvas aspect ratio, which
// smears the silhouette unrecognisably on anything but a square canvas. uConjugate is ±1: the
// second pass mirrors every orbit in the real axis, which the Buddhabrot is symmetric about.
const SPLAT_VERTEX = (codec: string): string => `
precision highp float;
` + codec + `
attribute vec2 aUv;
uniform sampler2D uZState;
uniform vec2 uProjection;
uniform float uConjugate;

void main() {
  vec2 z = decodeVec2(texture2D(uZState, aUv));
  // A texel that just reseeded sits at the origin and must not plot. Proximity rather than equality
  // because the fallback codec cannot round-trip an exact 0.0; the threshold is far above its
  // quantisation floor and far below any orbit value with real iterations behind it.
  if (dot(z, z) < 1e-7) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }
  else {
    gl_Position = vec4(vec2(z.x, z.y * uConjugate) * uProjection, 0.0, 1.0);
  }
  // 1.0 (a single texel) was the original value and is why the image read as discrete dust rather
  // than a solid image: unlike every other preset here, which is an analytic fragment shader that
  // fills every pixel every frame, this is a stochastic point splat, and a 1px point only ever lights
  // ONE texel - it merges into a continuous stroke only where enough OTHER points happen to land on
  // the exact same texel too. 3px gives each splat real overlap with its neighbours along the
  // filament, so nearby points blend into a stroke instead of standing apart as visible dots -
  // combined with the blur in the present pass below, not a substitute for it (a bigger point alone
  // still leaves gaps at low density; the two together are what actually reads as solid).
  gl_PointSize = 2;
}
`

const SPLAT_FRAGMENT = `
precision highp float;
uniform float uDensity;
void main() {
  gl_FragColor = vec4(vec3(uDensity), uDensity);
}
`

// blendFunc(ZERO, SRC_COLOR): result = dst · thisFragment'sColour, i.e. the accumulation buffer is
// multiplied by uDecay in place, every frame - see DECAY_HALF_LIFE_S's own comment for why this
// always runs now rather than only on the RGBA8 fallback path.
const DECAY_FRAGMENT = `
precision highp float;
uniform float uDecay;
void main() {
  gl_FragColor = vec4(uDecay, uDecay, uDecay, uDecay);
}
`

// Log tonemap (mirrored for tests as buddhabrotMath.ts's logTone) normalised against the estimated
// hottest density. Linear exposure cannot render this image: the range between the core and the
// filaments is orders of magnitude, so linear either clips the core to a flat block or leaves the
// filaments at zero - which is exactly the two-flat-bands result a linear version once produced.
// Single accumulation buffer - the continuous decay above is what keeps it alive frame to frame, so
// there is no separate "previous region" texture or crossfade to sample here.
// uTexel is the ACCUM texture's own texel size (1/accumWidth, 1/accumHeight) - deliberately not
// derived from uResolution (the CANVAS size), since the neighbourhood being blurred is the
// accumulation grid's, not the screen's.
const PRESENT_FRAGMENT = PRELUDE + `
uniform sampler2D uAccum;
uniform vec2 uTexel;
uniform float uNorm;
uniform float uToneK;
uniform float uAnchors;

// A 3x3 Gaussian-weighted blur of the RAW density, before exposure - not a substitute for the
// splat pass's own gl_PointSize (see that shader's comment), the two compound. Every other preset
// here is an analytic fragment shader that already produces a smooth field at every pixel; this one
// is a stochastic point splat, so even with bigger points the accumulated buffer still has real
// texel-to-texel variance from finitely many samples landing where they landed. Averaging density
// over a small neighbourhood is the standard "splat then blur" fix for exactly that - it is blurring
// sample NOISE, not blurring away real structure, since the actual filament shape lives at a much
// coarser scale than one texel.
float blurredDensity(vec2 uv) {
  float d = texture2D(uAccum, uv).r * 0.25;
  d += texture2D(uAccum, uv + vec2(uTexel.x, 0.0)).r * 0.125;
  d += texture2D(uAccum, uv - vec2(uTexel.x, 0.0)).r * 0.125;
  d += texture2D(uAccum, uv + vec2(0.0, uTexel.y)).r * 0.125;
  d += texture2D(uAccum, uv - vec2(0.0, uTexel.y)).r * 0.125;
  d += texture2D(uAccum, uv + uTexel).r * 0.0625;
  d += texture2D(uAccum, uv - uTexel).r * 0.0625;
  d += texture2D(uAccum, uv + vec2(uTexel.x, -uTexel.y)).r * 0.0625;
  d += texture2D(uAccum, uv + vec2(-uTexel.x, uTexel.y)).r * 0.0625;
  return d;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float density = blurredDensity(uv);
  float t = density / max(uNorm, 1e-6);
  float structure = clamp(log(1.0 + t * uToneK) / log(1.0 + uToneK), 0.0, 1.0);
  // Audio touches the exposure only, never the density field itself - same principle as Chaos's
  // audio-blind camera: loudness may brighten the VIEW, it may not lurch what is being viewed.
  structure = clamp(structure * (1.0 + 0.35 * uLevel), 0.0, 1.0);
  // uAnchors, not uChaosPalette - this preset gets its own wider anchor count (6-10, Canvas.vue's
  // buddhabrotAnchors) rather than the shared 3-5 Chaos/Fractal/Julia are tuned against. It still
  // rides the same uChaosHue drift chaosMix() reads internally, so the palette stays continuous
  // when switching between presets, just with more distinct colours across this one's own range.
  float count = clamp(uAnchors, 12.0, 35.0);
  vec3 col = chaosMix(structure, count, 0.0);
  // Unvisited plane must be black, not a dim tinted floor - multiplying by structure (0 at zero
  // density) is what makes the silhouette read as a silhouette.
  col *= structure;
  gl_FragColor = vec4(col, 1.0);
}
`

export interface BuddhabrotPass {
  resize: (width: number, height: number) => void
  draw: (frame: VisualizerFrame) => void
  reset: () => void
  dispose: () => void
}

/**
 * Build the Buddhabrot pass, or null if this GPU can't support it - a completeness failure on any
 * render target, or zero vertex texture image units, which the splat pass depends on to read the
 * state texture per point. Either way the caller falls back to the single-pass approximation shader
 * registered at FRAGMENT_SHADERS.buddhabrot (helpers/visualizer/shaders.ts).
 */
export const createBuddhabrotPass = (gl: WebGLRenderingContext): BuddhabrotPass | null => {
  if ((gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number) < 1) {
    return null
  }

  const support = detectFloatSupport(gl)
  const useFloat = support.state
  const floatAccum = support.accum !== 'byte'
  const codec = useFloat ? CODEC_FLOAT : CODEC_BYTES
  const textureType = useFloat ? gl.FLOAT : gl.UNSIGNED_BYTE
  const internalFormat = useFloat ? GL_RGBA32F : gl.RGBA
  const accumInternalFormat = support.accum === 'float32'
    ? GL_RGBA32F
    : support.accum === 'float16' ? GL_RGBA16F : gl.RGBA
  const accumType = support.accum === 'float32'
    ? gl.FLOAT
    : support.accum === 'float16' ? GL_HALF_FLOAT : gl.UNSIGNED_BYTE
  const densityIncrement = floatAccum ? FLOAT_DENSITY_INCREMENT : BYTE_DENSITY_INCREMENT
  // Always decaying now, float path included - see DECAY_HALF_LIFE_S's own comment for why: a
  // buffer that never forgets can't follow a continuously drifting region, it can only ever average
  // over everywhere it has ever pointed.
  const decayFactor = halfLifeToDecayFactor(DECAY_HALF_LIFE_S, 60)

  const advanceUniforms = [
    'uStateResolution', 'uFrame', 'uReseedProb', 'uBirthSpread',
    'uZState', 'uCState', 'uNoise', 'uSeedPool', 'uSeedCount',
  ]
  const advanceZ = linkProgram(gl, VERTEX_SHADER, ADVANCE_Z_FRAGMENT(codec), advanceUniforms, 'aPosition')
  const advanceC = linkProgram(gl, VERTEX_SHADER, ADVANCE_C_FRAGMENT(codec), advanceUniforms, 'aPosition')
  const splat = linkProgram(gl, SPLAT_VERTEX(codec), SPLAT_FRAGMENT, ['uZState', 'uDensity', 'uProjection', 'uConjugate'], 'aUv')
  const decay = linkProgram(gl, VERTEX_SHADER, DECAY_FRAGMENT, ['uDecay'], 'aPosition')
  const present = linkProgram(gl, VERTEX_SHADER, PRESENT_FRAGMENT, [
    'uResolution', 'uLevel', 'uChaosHue', 'uAccum', 'uTexel', 'uNorm', 'uToneK', 'uAnchors',
  ], 'aPosition')
  if (!advanceZ || !advanceC || !splat || !decay || !present) {
    return null
  }

  // This module's own fullscreen-triangle geometry rather than reaching into renderer.ts's private
  // buffer, since the two are meant to stay fully decoupled.
  const quad = gl.createBuffer()
  if (!quad) {
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const fbo = gl.createFramebuffer()
  if (!fbo) {
    return null
  }

  let stateWidth = 0
  let stateHeight = 0
  let accumWidth = 0
  let accumHeight = 0
  let zA: WebGLTexture | null = null
  let zB: WebGLTexture | null = null
  let cA: WebGLTexture | null = null
  let cB: WebGLTexture | null = null
  let accum: WebGLTexture | null = null
  let noise: WebGLTexture | null = null
  let seedPool: WebGLTexture | null = null
  let uvBuffer: WebGLBuffer | null = null
  let uvCount = 0
  let frame = 0
  let seedCount = 0
  // Reused every frame so uploading the pool never allocates.
  let seedScratch: Float32Array | Uint8Array = useFloat
    ? new Float32Array(SEED_POOL_CAPACITY * 4)
    : new Uint8Array(SEED_POOL_CAPACITY * 4)

  const createTexture = (
    width: number,
    height: number,
    filter: number,
    data: ArrayBufferView | null,
    format: number = internalFormat,
    type: number = textureType,
  ): WebGLTexture | null => {
    const texture = gl.createTexture()
    if (!texture) {
      return null
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, type, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  // Attaches `texture` to `fbo` and checks completeness - the one genuinely new failure class this
  // module introduces. Returns false so the caller can bail to the fallback preset rather than
  // silently drawing nothing forever.
  const attachAndCheck = (texture: WebGLTexture): boolean => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  }

  // Every state texel starts far outside the escape radius, so the very first advance pass sees it
  // as escaped and reseeds it from the pool. That is simpler and more robust than hand-crafting a
  // "please reseed me" sentinel, and it means a zero-filled c (which is INSIDE the set and would
  // otherwise never escape) can never strand a texel.
  const makeStateInit = (width: number, height: number): ArrayBufferView => {
    const texels = width * height
    if (useFloat) {
      const data = new Float32Array(texels * 4)
      for (let i = 0; i < texels; i++) {
        data[i * 4] = 8
        data[i * 4 + 1] = 8
        data[i * 4 + 3] = 1
      }
      return data
    }
    // Zero bytes decode to (-4, -4) through CODEC_BYTES, whose squared modulus is 32 - already well
    // past the bailout, so plain zeros do the same job here.
    return new Uint8Array(texels * 4)
  }

  const deleteTargets = () => {
    for (const tex of [zA, zB, cA, cB, accum, noise, seedPool]) {
      if (tex) {
        gl.deleteTexture(tex)
      }
    }
    if (uvBuffer) {
      gl.deleteBuffer(uvBuffer)
    }
    zA = null
    zB = null
    cA = null
    cB = null
    accum = null
    noise = null
    seedPool = null
    uvBuffer = null
  }

  const allocate = (canvasWidth: number, canvasHeight: number): boolean => {
    deleteTargets()
    ;[stateWidth, stateHeight] = accumulationSize(canvasWidth, canvasHeight, STATE_CAP)
    ;[accumWidth, accumHeight] = accumulationSize(canvasWidth, canvasHeight, ACCUM_CAP)

    const stateInit = makeStateInit(stateWidth, stateHeight)
    zA = createTexture(stateWidth, stateHeight, gl.NEAREST, stateInit)
    zB = createTexture(stateWidth, stateHeight, gl.NEAREST, stateInit)
    cA = createTexture(stateWidth, stateHeight, gl.NEAREST, stateInit)
    cB = createTexture(stateWidth, stateHeight, gl.NEAREST, stateInit)
    // Null data, then cleared through the framebuffer below - a half-float texture would otherwise
    // need its initial contents built as a Uint16Array, and gl.clear() does the same job for free.
    accum = createTexture(
      accumWidth,
      accumHeight,
      support.accumFilterLinear ? gl.LINEAR : gl.NEAREST,
      null,
      accumInternalFormat,
      accumType,
    )
    seedPool = createTexture(SEED_POOL_CAPACITY, 1, gl.NEAREST, null)

    // Real CPU randomness, not a GPU hash - see ADVANCE_UNIFORMS_GLSL. Always bytes: this one is
    // only ever read as four independent 0-1 values, so it needs no precision and no codec.
    const noiseTexture = gl.createTexture()
    if (!noiseTexture) {
      return false
    }
    const noiseBytes = new Uint8Array(stateWidth * stateHeight * 4)
    for (let i = 0; i < noiseBytes.length; i++) {
      noiseBytes[i] = Math.floor(Math.random() * 256)
    }
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, stateWidth, stateHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseBytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    noise = noiseTexture

    if (!zA || !zB || !cA || !cB || !accum || !seedPool) {
      return false
    }
    // One check per distinct size/format combination - the four state textures are created
    // identically, so completeness for one implies it for the rest.
    if (!attachAndCheck(zA) || !attachAndCheck(accum)) {
      return false
    }

    const grid = buildStateUvGrid(stateWidth, stateHeight)
    uvCount = stateWidth * stateHeight
    uvBuffer = gl.createBuffer()
    if (!uvBuffer) {
      return false
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW)
    clearAccum()
    return true
  }

  // renderer.ts always calls resize() right after setPreset() picks this pass up, so the first real
  // allocation happens there, sized to the actual canvas rather than a guess.
  let ready = false

  // Pushes the CPU's verified seed pool into its texture. Written through the SAME codec the c state
  // texture uses, so a seed lands on the GPU as exactly the value buddhabrotMath.ts quantised and
  // then proved escapes.
  const uploadSeeds = (seeds: Float32Array) => {
    if (!seedPool) {
      return
    }
    seedCount = Math.min(Math.floor(seeds.length / 2), SEED_POOL_CAPACITY)
    if (seedCount === 0) {
      return
    }
    if (useFloat) {
      const data = seedScratch as Float32Array
      for (let i = 0; i < seedCount; i++) {
        data[i * 4] = seeds[i * 2] ?? 0
        data[i * 4 + 1] = seeds[i * 2 + 1] ?? 0
        data[i * 4 + 2] = 0
        data[i * 4 + 3] = 1
      }
    }
    else {
      const data = seedScratch as Uint8Array
      for (let i = 0; i < seedCount; i++) {
        // stateLevel(), not a local copy of the maths: it is the single definition of which 16-bit
        // level a value belongs to, and it is what generateSeedPool verified the seed AS.
        const packedX = stateLevel(seeds[i * 2] ?? 0)
        const packedY = stateLevel(seeds[i * 2 + 1] ?? 0)
        data[i * 4] = Math.floor(packedX / 256)
        data[i * 4 + 1] = packedX % 256
        data[i * 4 + 2] = Math.floor(packedY / 256)
        data[i * 4 + 3] = packedY % 256
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, seedPool)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, seedCount, 1, gl.RGBA, textureType, seedScratch)
  }

  const clearAccum = () => {
    if (!accum) {
      return
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accum, 0)
    gl.viewport(0, 0, accumWidth, accumHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  const drawFullscreenTriangle = (compiled: CompiledProgram) => {
    gl.useProgram(compiled.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(compiled.attribute)
    gl.vertexAttribPointer(compiled.attribute, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const resize = (width: number, height: number) => {
    ready = allocate(width, height)
    frame = 0
  }

  // Used when the preset is freshly opened (renderer.ts's setPreset) - starting from black is
  // exactly right there. Nothing else calls this: the sampled region now drifts continuously every
  // frame (Canvas.vue's BUDDHABROT_SWEEP) rather than jumping, and the short decay above is what
  // lets the accumulated image keep following that drift on its own, with no reset needed.
  const reset = () => {
    if (!ready) {
      return
    }
    const stateInit = makeStateInit(stateWidth, stateHeight)
    for (const tex of [zA, zB, cA, cB]) {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, stateWidth, stateHeight, 0, gl.RGBA, textureType, stateInit)
    }
    clearAccum()
    frame = 0
  }

  const bindAdvanceInputs = (compiled: CompiledProgram) => {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, zA)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, cA)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, noise)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, seedPool)
    gl.uniform1i(compiled.uniforms.uZState ?? null, 0)
    gl.uniform1i(compiled.uniforms.uCState ?? null, 1)
    gl.uniform1i(compiled.uniforms.uNoise ?? null, 2)
    gl.uniform1i(compiled.uniforms.uSeedPool ?? null, 3)
    gl.uniform1f(compiled.uniforms.uSeedCount ?? null, seedCount)
    gl.uniform2f(compiled.uniforms.uStateResolution ?? null, stateWidth, stateHeight)
    gl.uniform1f(compiled.uniforms.uFrame ?? null, frame)
    gl.uniform1f(compiled.uniforms.uReseedProb ?? null, SAFETY_RESEED_PROB)
    gl.uniform1f(compiled.uniforms.uBirthSpread ?? null, BIRTH_SPREAD_FRAMES)
  }

  const draw = (frameData: VisualizerFrame) => {
    if (!ready || !zA || !zB || !cA || !cB || !accum || !noise || !seedPool || !uvBuffer) {
      return
    }
    uploadSeeds(frameData.buddhabrotSeeds)
    if (seedCount === 0) {
      return
    }
    frame++

    // 1. ADVANCE Z and ADVANCE C: both read the SAME old (zA, cA) pair and each write their own
    // next buffer, so the order between them doesn't matter.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, stateWidth, stateHeight)

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, zB, 0)
    gl.useProgram(advanceZ.program)
    bindAdvanceInputs(advanceZ)
    drawFullscreenTriangle(advanceZ)

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cB, 0)
    gl.useProgram(advanceC.program)
    bindAdvanceInputs(advanceC)
    drawFullscreenTriangle(advanceC)

    ;[zA, zB] = [zB, zA]
    ;[cA, cB] = [cB, cA]

    // 2. SPLAT: additive points into accum, reading the just-advanced z (zA post-swap). Drawn twice
    // - once as-is, once mirrored in the real axis, which the Buddhabrot is symmetric about.
    const [projectionX, projectionY] = projectionScale(accumWidth, accumHeight, VIEW_SCALE)
    gl.activeTexture(gl.TEXTURE0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accum, 0)
    gl.viewport(0, 0, accumWidth, accumHeight)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(splat.program)
    gl.bindTexture(gl.TEXTURE_2D, zA)
    gl.uniform1i(splat.uniforms.uZState ?? null, 0)
    gl.uniform1f(splat.uniforms.uDensity ?? null, densityIncrement)
    gl.uniform2f(splat.uniforms.uProjection ?? null, projectionX, projectionY)
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.enableVertexAttribArray(splat.attribute)
    gl.vertexAttribPointer(splat.attribute, 2, gl.FLOAT, false, 0, 0)
    for (const conjugate of [1, -1]) {
      gl.uniform1f(splat.uniforms.uConjugate ?? null, conjugate)
      gl.drawArrays(gl.POINTS, 0, uvCount)
    }

    // 3. DECAY: always, now - see DECAY_HALF_LIFE_S's own comment for why this can no longer be a
    // fallback-only step once the sampled region drifts continuously instead of holding still.
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR)
    gl.useProgram(decay.program)
    gl.uniform1f(decay.uniforms.uDecay ?? null, decayFactor)
    drawFullscreenTriangle(decay)
    gl.disable(gl.BLEND)

    // 4. PRESENT: tonemap + palette into the default framebuffer at the full canvas viewport -
    // restoring exactly the state every other preset's draw() already assumes going in.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const canvasWidth = gl.drawingBufferWidth
    const canvasHeight = gl.drawingBufferHeight
    gl.viewport(0, 0, canvasWidth, canvasHeight)
    gl.useProgram(present.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, accum)
    gl.uniform1i(present.uniforms.uAccum ?? null, 0)
    gl.uniform2f(present.uniforms.uTexel ?? null, 1 / accumWidth, 1 / accumHeight)
    gl.uniform2f(present.uniforms.uResolution ?? null, canvasWidth, canvasHeight)
    gl.uniform1f(present.uniforms.uLevel ?? null, frameData.level)
    gl.uniform1f(present.uniforms.uChaosHue ?? null, frameData.chaosHue)
    gl.uniform1f(present.uniforms.uAnchors ?? null, frameData.buddhabrotAnchors)
    gl.uniform1f(present.uniforms.uToneK ?? null, TONE_K)
    gl.uniform1f(present.uniforms.uNorm ?? null, estimateNormalisation(
      frame,
      uvCount * 2,
      accumWidth * accumHeight,
      densityIncrement,
      decayFactor,
      PEAK_OVER_MEAN,
    ))
    drawFullscreenTriangle(present)
  }

  const dispose = () => {
    deleteTargets()
    gl.deleteFramebuffer(fbo)
    gl.deleteBuffer(quad)
    gl.deleteProgram(advanceZ.program)
    gl.deleteProgram(advanceC.program)
    gl.deleteProgram(splat.program)
    gl.deleteProgram(decay.program)
    gl.deleteProgram(present.program)
    seedScratch = useFloat ? new Float32Array(0) : new Uint8Array(0)
  }

  return { resize, draw, reset, dispose }
}
