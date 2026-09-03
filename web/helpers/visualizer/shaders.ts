// GLSL for the fullscreen visualizer. Written to GLSL ES 1.00 (no `#version` line, `gl_FragColor`,
// `texture2D`) so one source compiles unchanged against both a WebGL2 and a WebGL1 context - the
// renderer falls back to WebGL1 on older hardware and must not carry two copies of every preset.
//
// Every preset draws a single fullscreen quad; all the shape comes from the fragment stage. Colour
// comes from three independent sources, none of them locked to whatever accent colour happens to
// be picked for buttons except where that's the point: accent() ties a preset to the active theme
// (uHue, degrees, via Settings → Themes) - Spectrum keeps this, reading as a literal on-brand level
// meter. freeColor() free-runs through the whole hue wheel on its own slow schedule (Fractal,
// Tunnel). chaosColor() is Chaos's own, driven by uChaosHue - a CPU-computed, explicitly-eased
// A-to-B morph (helpers/visualizer/hueMorph.ts) rather than a formula, because Chaos's shape moves
// fast enough that freeColor()'s slow drift read as the colour jumping instead of gliding.

import type { VisualizerPresetId } from '~/helpers/constants'

export const VERTEX_SHADER = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// Shared uniform block + helpers, prepended to every preset body below so there is exactly one
// definition of the noise/palette/sampling functions rather than one per shader.
const PRELUDE = `
precision highp float;

uniform vec2  uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uHue;
uniform float uSeed;
uniform vec2  uJuliaC;
uniform float uChaosHue;
uniform sampler2D uSpectrum;
uniform sampler2D uWaveform;
uniform sampler2D uPeaks;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 0.6666666, 0.3333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Accent-anchored palette: uHue is the active theme's accent as an HSV hue in degrees (converted
// from the authored oklch by helpers/oklch.ts), shift is a rotation in turns.
//
// Keep every shift small AND centred on zero. A quarter-turn is 90 degrees, which lands on a
// completely different colour - the first cut of these shaders swept up to 0.6 turns and the amber
// theme rendered green. The default accent sits at HSV 39 degrees with yellow at 60 and green at
// 90, so it has barely 0.06 of a turn of headroom before it stops looking like itself: a shift
// that only ever adds drifts the whole image off-accent, which is why each one below is written
// as a deviation either side of the accent rather than an offset from it.
//
// Contrast belongs in the value and saturation arguments, not the hue. The one exception is the
// deliberate +0.5 complement a couple of presets use as a sparse highlight.
vec3 accent(float shift, float sat, float val) {
  return hsv2rgb(vec3(fract(uHue / 360.0 + shift), sat, val));
}

// Free-running palette, decoupled from the accent entirely. A slow constant rotation (one full
// pass of the wheel roughly every two minutes) guarantees it actually cycles through every hue
// over a session rather than idling near wherever it started, plus a gentle two-term wobble on
// top so it doesn't read as a mechanical rainbow-cycle. uSeed (0..1, re-rolled whenever the
// overlay opens or the preset is switched - see components/visualizer/Canvas.vue) starts each
// run at a different point on the wheel, which is the "purely random" part: nothing here is
// derived from the accent, the noise field, or any other on-screen value, only wall-clock time
// and that seed. Per-pixel random colour was tried and rejected - it reads as static, not motion.
float hueBase(float t) {
  float wobble = sin(t * 0.083) * 0.05 + sin(t * 0.031 + 2.1) * 0.03;
  return fract(uSeed + t * 0.008 + wobble);
}

// Contrast floor: two hues 120 degrees apart still read as barely distinguishable if both are
// nearly white, because saturation - not hue angle - is what makes a colour read as a colour
// rather than a shade of grey/white. This was the actual bug behind "not enough contrast": Chaos's
// glow layer passed sat=0.4 and Fractal's passed 0.3, both washing toward white exactly where they
// overlap the base layer, which is where contrast matters most. Clamping the floor in one place
// means every layer in every preset keeps a visible tint no matter what a call site passes, rather
// than relying on each of a dozen call sites to remember a "not too low" number.
const float FREE_COLOR_MIN_SAT = 0.55;

// Every preset that layers multiple freeColor() results (Chaos: 3 layers a third of the wheel
// apart; Fractal/Tunnel: 2 layers half the wheel apart, i.e. complementary) keeps its shift
// arguments at least this far apart, so hue alone already guarantees strong contrast between
// layers - the saturation floor above is what keeps that contrast visible once brightness and
// mixing are applied on top.
vec3 freeColor(float shift, float sat, float val) {
  return hsv2rgb(vec3(fract(hueBase(uTime) + shift), max(sat, FREE_COLOR_MIN_SAT), val));
}

// Chaos's own colour, deliberately NOT freeColor()/hueBase(): hueBase() only ever drifts by a
// couple of percent of a turn per second, which combined with how fast Chaos's shape itself
// reshapes (spin, zoom, the Julia path) made the rendered colour look like it was jumping rather
// than drifting - there was nothing wrong with the hue maths, the shape underneath it was just
// moving too fast for a slow global drift to read as smooth. uChaosHue is instead a fully-formed
// hue (0-1, already eased) computed on the CPU by components/visualizer/Canvas.vue via
// helpers/visualizer/hueMorph.ts: pick a random target, ease into it over a random 5-11s, repeat -
// an explicit A-to-B morph instead of a formula this shader has no control over the pacing of.
vec3 chaosColor(float shift, float sat, float val) {
  return hsv2rgb(vec3(fract(uChaosHue + shift), max(sat, FREE_COLOR_MIN_SAT), val));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    total += noise(p) * amp;
    p = p * 2.02 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return total;
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// Square pixels, origin at the centre, short edge spanning -1..1 - so a preset looks the same on
// a phone in portrait as on an ultrawide.
vec2 centered() {
  return (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);
}

float spectrumAt(float x) {
  return texture2D(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

float peakAt(float x) {
  return texture2D(uPeaks, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

float waveAt(float x) {
  return texture2D(uWaveform, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0;
}
`

// Deliberately not Fractal's cousin: no polar symmetry fold, no orbit-trap glow, and c is not
// computed here at all - it arrives as uJuliaC, walked each frame along a precomputed path built
// by helpers/visualizer/juliaPath.ts (getBoundaryJuliaPath + juliaCAlongPath), a closed loop of
// constants that are always just OUTSIDE the Mandelbrot set. That invariant is the whole reason
// this preset shows filigree instead of a plateau: a c inside the set gives a filled Julia set
// whose interior renders as one flat slab of colour (all of it hits the iteration cap), and
// zooming in just fills the screen with that slab. A c just outside has no interior at all - the
// set is a dendrite - so every pixel carries an escape gradient and the frame is spiral filigree
// throughout. The path is precomputed rather than searched live per frame for a second reason
// beyond cost: the escape-time landscape right at the boundary is itself discontinuous, so two
// barely-different inputs to a live search can legitimately land on unrelated points - and a Julia
// set is sensitive enough to c that even a small jump there reads as the entire fractal jumping.
// Building the path once, smoothing it, and just interpolating along it at runtime removes that
// discontinuity by construction.
//
// The view spins while it breathes in and out (bounded, not one-way - that would eventually blow
// through float precision in a session left open a while), which is what reads as "spiraling into
// infinity" as motion, on top of the dendrite's own spiral arms. That camera transform is
// deliberately audio-blind - it used to swell zoom with uLevel, which made the whole frame jump in
// scale on every snare/kick hit. uLevel/uMid/uTreble still drive colour and texture below, which
// pulses in brightness on the beat without the screen itself moving.
const CHAOS = `
void main() {
  vec2 p = centered();

  // Modest range on purpose (about 0.5x to 5x). With no interior to fall into, this is about
  // framing the dendrite rather than diving through a plateau - the old exp(1.0 + 1.6·sin) went
  // deep enough to fill the screen with a single component. Breathing rate 0.06 -> 0.015 (4x
  // slower, per request) - the range itself (1.1, 0.35) is how dramatic each dive is, untouched by
  // a speed change.
  //
  // Deliberately no uLevel/uBass term here (there used to be a + uLevel * 0.3): the loudness RMS
  // spikes on every snare and kick hit, so folding it into the zoom made the whole frame visibly
  // jump in scale on every hit - the screen "moving" with the beat. The camera transform (zoom,
  // spin) is now purely time-driven and never reacts to audio; uLevel/uMid/uTreble still drive
  // colour and texture further down, which is brightness pulsing, not the screen relocating.
  float zoom = exp(0.35 + 1.1 * sin(uTime * 0.015));
  // 0.035 -> 0.00875 (4x slower, per request).
  float spin = uTime * 0.00875;
  vec2 z = rot2(spin) * p / zoom;

  float esc = 0.0;
  float trap = 10000.0;
  for (int i = 0; i < 96; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uJuliaC;
    trap = min(trap, dot(z, z));
    if (dot(z, z) > 16.0) {
      break;
    }
    esc += 1.0;
  }

  // Continuous escape count, same reasoning as Fractal: the raw iteration index quantises the
  // image into flat contour bands instead of a smooth falloff.
  float dz = dot(z, z);
  float m = esc;
  if (dz > 16.0) {
    m = esc + 1.0 - log2(max(log2(dz), 1.0001));
  }
  m = clamp(m / 96.0, 0.0, 1.0);

  // Extra banding on top of the shade - a higher, treble-driven stripe count - is what makes this
  // read as busier and faster than Fractal's calmer single glow.
  float bands = fract(m * (6.0 + uTreble * 3.0));
  float shade = pow(m, 0.4);
  float glow = pow(1.0 - clamp(trap * 4.0, 0.0, 1.0), 1.4);

  // Small, shade-driven wobble on the base hue - the same tiny-amplitude contract chaosColor()'s
  // sibling freeColor() keeps to elsewhere. bands used to feed the hue directly at up to half a
  // turn (bands * 0.5); since bands tracks the escape count under a c that is itself moving fast
  // and chaotically, that swung a huge arc of the colour wheel from one frame/pixel to the next -
  // that flicker was the strobe. bands still varies just as fast now, but only as brightness of
  // its own fixed-hue layer below, which reads as shimmer instead of colour-cycling.
  float wobble = (shade - 0.5) * 0.05 + uTreble * 0.02;

  // Three hues on screen at once, triadic (a third of the wheel apart) rather than a base plus its
  // complement: body, band texture and glow highlight each keep their own third, and all three
  // morph together since they all read off the same uChaosHue.
  vec3 col = chaosColor(wobble, 0.9 - shade * 0.3, shade * 1.1);
  col += chaosColor(wobble + 1.0 / 3.0, 0.75, 1.0) * bands * shade * 0.35;
  // Written as 0.55, not lower: chaosColor() clamps to FREE_COLOR_MIN_SAT anyway, and a literal
  // that understates its own effective value is worse than no literal.
  col += chaosColor(wobble + 2.0 / 3.0, 0.55, 1.0) * glow * (1.0 - m) * 0.8;
  col *= 0.6 + 0.7 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

// Julia set whose constant c orbits a circle - the orbit angle is time plus bass, so a kick shoves
// the set through a shape change rather than just brightening it. Six-fold polar folding turns it
// into a kaleidoscope; the orbit trap supplies the inner glow.
const FRACTAL = `
void main() {
  vec2 p = centered() * (1.35 - uBass * 0.35);
  p = rot2(uTime * 0.05) * p;

  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = 3.14159265 / 3.0;
  a = abs(mod(a + seg * 0.5, seg) - seg * 0.5);
  p = vec2(cos(a), sin(a)) * r;

  float theta = uTime * 0.23 + uBass * 3.0;
  vec2 c = vec2(cos(theta), sin(theta)) * (0.7885 - uMid * 0.12);

  vec2 z = p;
  float esc = 0.0;
  float trap = 10000.0;
  for (int i = 0; i < 48; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    trap = min(trap, dot(z, z));
    if (dot(z, z) > 16.0) {
      break;
    }
    esc += 1.0;
  }

  float dz = dot(z, z);
  float m = esc;
  // Continuous escape count. The raw integer iteration index quantises the image into flat
  // contour bands - this is what makes the falloff smooth instead of stepped.
  if (dz > 16.0) {
    m = esc + 1.0 - log2(max(log2(dz), 1.0001));
  }
  m = clamp(m / 48.0, 0.0, 1.0);

  // Most of the frame escapes within a few iterations, so m is tiny almost everywhere. A gamma
  // ABOVE 1 crushes that to black (the first cut used 1.6 and rendered an all-but-invisible
  // frame); a fractional exponent lifts the fast-escaping majority into view instead.
  float shade = pow(m, 0.45);
  float glow = pow(1.0 - clamp(trap * 3.0, 0.0, 1.0), 1.5);

  // The trap also textures the interior, which the escape count alone leaves as a flat plateau -
  // inside the set every point has the same iteration count, so there is nothing else to shade with.
  float inner = 0.78 + 0.22 * (1.0 - clamp(trap * 6.0, 0.0, 1.0));
  vec3 col = freeColor((shade - 0.5) * 0.06 + uTreble * 0.02, 0.95 - shade * 0.45, shade * 1.05 * inner);
  // Weighted to the boundary by (1 - m): the interior traps hardest, so an ungated glow simply
  // blows the whole set out to a flat white blob and throws away all that filigree on its edge.
  // Written as 0.55, not lower: freeColor() clamps to FREE_COLOR_MIN_SAT anyway.
  col += freeColor(0.5, 0.55, 1.0) * glow * (1.0 - m) * (0.35 + uBass * 1.2);
  col *= 0.6 + 0.7 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

// 1/r polar mapping is the whole trick: rings that are evenly spaced in depth bunch up towards the
// centre and read as an infinite corridor. Travel speed follows overall level, and the spectrum is
// wrapped around the tunnel wall so the texture is the music.
const TUNNEL = `
void main() {
  vec2 p = centered();
  float r = max(length(p), 0.0015);
  float a = atan(p.y, p.x) / 6.2831853;

  // The numerator has to be big enough that rings are still resolvable out at the frame edge.
  // At 0.32 the whole ring stack crowded into the middle, leaving the outer field a flat wash
  // that the angular term then turned into a starburst instead of a corridor.
  float z = 1.4 / r + uTime * (0.5 + uLevel * 1.4);
  float twist = a + sin(z * 0.2) * 0.05 + uTime * 0.015;

  // cos over z, not fract: a hard sawtooth at the vanishing point aliases into a moire mess
  // where the rings bunch tightest.
  float rings = 0.5 + 0.5 * cos(z * 6.2831853);
  float spokes = 0.5 + 0.5 * cos(fract(twist) * 6.2831853 * 24.0);
  // Mirrored, so the spectrum wraps the tunnel wall without a seam where its loud low end would
  // otherwise butt straight up against its quiet top end.
  float spec = spectrumAt(abs(fract(twist) * 2.0 - 1.0));

  // Bright near wall, dark vanishing point. Without this the whole depth cue inverts and the
  // tunnel reads as a flat disc with a hole in it.
  float depthFade = smoothstep(0.05, 0.85, r);
  float wall = pow(rings, 1.6) * (0.4 + 0.9 * spec) * (0.85 + 0.15 * spokes);

  // z grows without bound as the tunnel travels, so its own contribution to the shift has to go
  // through a periodic function (sin) - fed in raw it would spin the local wobble arbitrarily far
  // from wherever freeColor's own drift currently sits, rather than wobbling around it.
  vec3 col = freeColor(sin(z * 0.12) * 0.05 + (spec - 0.5) * 0.06, 0.9 - wall * 0.35, wall * 1.4 * depthFade);
  // A pulse of light coming up the throat on the kick.
  col += freeColor(0.0, 0.8, 1.0) * pow(1.0 - depthFade, 3.0) * (0.2 + uBass * 1.6);
  col *= 0.45 + 0.75 * uLevel;
  col *= smoothstep(2.4, 0.3, length(p));
  gl_FragColor = vec4(col, 1.0);
}
`

// The literal Winamp one: 48 FFT bars with falling peak caps, plus an oscilloscope through the
// middle. uPeaks carries the caps because a maximum that decays over time is per-frame state the
// CPU owns (helpers/audioBands.ts decayPeaks), not something a stateless fragment shader can hold.
const SPECTRUM = `
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float bars = 48.0;

  float slot = floor(uv.x * bars);
  float within = fract(uv.x * bars);
  float gap = step(0.1, within) * step(within, 0.9);
  float x = (slot + 0.5) / bars;

  float h = pow(spectrumAt(x), 1.35) * 0.8;
  float peak = pow(peakAt(x), 1.35) * 0.8;

  float bar = step(uv.y, h) * gap;
  float cap = step(abs(uv.y - peak - 0.014), 0.007) * gap;

  // Deep and saturated at the foot, washing out towards white at the tip - the direction every
  // hardware level meter runs, and the one that reads as "louder" going up.
  vec3 col = accent(-0.02 + uv.y * 0.04, 0.95 - uv.y * 0.55, 1.0) * bar;
  col += vec3(1.0) * cap * 0.9;

  // A warm near-white for the scope rather than the accent's complement: at amber that complement
  // is blue, which reads as a different product's colour rather than as this one's.
  float wave = waveAt(uv.x) * (0.16 + uLevel * 0.5);
  col += accent(0.02, 0.22, 1.0) * smoothstep(0.012, 0.0, abs((uv.y - 0.5) - wave));

  col += accent(0.0, 0.8, 1.0) * 0.06 * uBass;
  gl_FragColor = vec4(col, 1.0);
}
`

export const FRAGMENT_SHADERS: Record<VisualizerPresetId, string> = {
  chaos: PRELUDE + CHAOS,
  fractal: PRELUDE + FRACTAL,
  tunnel: PRELUDE + TUNNEL,
  spectrum: PRELUDE + SPECTRUM,
}
