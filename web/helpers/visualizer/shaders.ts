// GLSL for the fullscreen visualizer. Written to GLSL ES 1.00 (no `#version` line, `gl_FragColor`,
// `texture2D`) so one source compiles unchanged against both a WebGL2 and a WebGL1 context - the
// renderer falls back to WebGL1 on older hardware and must not carry two copies of every preset.
//
// Every preset draws a single fullscreen quad; all the shape comes from the fragment stage. Colour
// comes from one shared source now: chaosColor()/chaosRole()/chaosAnchor()/chaosMix() - "N
// contrasting anchors, mixed by structure, not layered" - driven by uChaosHue (a CPU-computed,
// explicitly-eased A-to-B morph, helpers/visualizer/hueMorph.ts) and uChaosPalette (how many
// anchors, 3-5). Every preset in this file reads the same drifting palette state, so switching
// between them stays visually continuous rather than jumping to an unrelated colour scheme.

import type { VisualizerPresetId } from '~/helpers/constants'

export const VERTEX_SHADER = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// Shared uniform block + helpers, prepended to every preset body below so there is exactly one
// definition of the palette/sampling functions rather than one per shader.
export const PRELUDE = `
precision highp float;

uniform vec2  uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform vec2  uJuliaC;
uniform float uChaosHue;
uniform float uChaosPalette;
// The single Julia constant Fractal's one repeating tile currently renders - see the comment on
// const FRACTAL below for why it's a lone vec2, not an array.
uniform vec2  uFractalC;
// Julia's drifting power (z <- z^n + c) - see const JULIA below.
uniform float uJuliaPower;
// Julia's own picked-and-validated constant, eased between successive CPU-picked targets exactly
// like uFractalC - see const JULIA below and helpers/visualizer/juliaField.ts.
uniform vec2  uJuliaSetC;
// Flow's warp-seed offset - an extra additive term folded into its fbm coordinate space, slowly
// orbiting on the CPU (Canvas.vue's flowSeed) so the plasma keeps exploring new neighbourhoods
// instead of ever holding still or replaying the same session - see const FLOW below.
uniform vec2  uFlowSeed;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 0.6666666, 0.3333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Contrast floor: two hues 120 degrees apart still read as barely distinguishable if both are
// nearly white, because saturation - not hue angle - is what makes a colour read as a colour
// rather than a shade of grey/white. This was the actual bug behind "not enough contrast": a
// glow layer passing a low saturation washes toward white exactly where it overlaps the base
// layer, which is where contrast matters most. Clamping the floor in one place means every layer
// in every preset keeps a visible tint no matter what a call site passes.
const float FREE_COLOR_MIN_SAT = 0.55;

// Chaos's own colour: uChaosHue is a fully-formed hue (0-1, already eased) computed on the CPU by
// components/visualizer/Canvas.vue via helpers/visualizer/hueMorph.ts - pick a random target, ease
// into it over a random 5-9s, repeat - an explicit A-to-B morph instead of a formula this shader
// has no control over the pacing of. shift is a rotation in turns.
vec3 chaosColor(float shift, float sat, float val) {
  return hsv2rgb(vec3(fract(uChaosHue + shift), max(sat, FREE_COLOR_MIN_SAT), val));
}

// Role gradient sampled along the anchor chain: s=0 is the ground anchor (dark, saturated - reads
// as shadow), s=0.5 is mid (pale filigree), s=1 is core (fully saturated hot highlight). With 3-5
// anchors picked per palette (uChaosPalette, re-rolled by components/visualizer/Canvas.vue in step
// with the hue morph), each anchor samples this at its own position in the chain rather than a
// hardcoded 3-way ground/mid/core split, so 4 or 5 anchors interpolate smoothly through the same
// dark-to-pale-to-hot journey instead of needing a bespoke curve per count.
vec2 chaosRole(float s) {
  float sat = s < 0.5 ? mix(0.75, 0.3, s * 2.0) : mix(0.3, 0.95, (s - 0.5) * 2.0);
  float val = s < 0.5 ? mix(0.16, 1.0, s * 2.0) : 1.0;
  return vec2(sat, val);
}

// Anchor i of count, hues spread evenly round the whole wheel (i / count) rather than fixed thirds
// - a 5-anchor palette still guarantees contrast between neighbours since the spacing itself widens
// or narrows with count, and it still rides the one CPU-eased uChaosHue morph so every anchor
// drifts together. hueShift lets a caller offset its whole chain from that shared base - every
// preset below passes 0.0 (one chain, screen-wide).
vec3 chaosAnchor(float i, float count, float hueShift) {
  vec2 role = chaosRole(i / max(count - 1.0, 1.0));
  return chaosColor(hueShift + i / count, role.x, role.y);
}

// Composite by MIXING between neighbouring anchors along the chain, keyed by a caller-supplied
// escape/trap "structure" value - not by adding every anchor as a translucent layer, which was the
// actual cause of "everything reads as one colour with subtle variation": a single dominant layer
// covered the whole frame at full strength and the rest were only ever thin accents on top of it,
// so nearly every pixel's dominant colour stayed the same one regardless of how different the
// anchors were. Mixing means each pixel resolves toward ONE anchor - the way a real
// orbit-trap-coloured render reads. Hoisted here once every preset below needed the identical five
// lines; each still supplies its own "structure" formula (their shading differs), and still
// layers a separate hot-core mix on top of what this returns.
vec3 chaosMix(float structure, float count, float hueShift) {
  float scaled = clamp(structure, 0.0, 1.0) * (count - 1.0);
  float idx0 = floor(min(scaled, count - 1.001));
  return mix(chaosAnchor(idx0, count, hueShift), chaosAnchor(idx0 + 1.0, count, hueShift), fract(scaled));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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
  // read as busier and faster than Fractal's calmer single glow. Pushed denser than before (10 vs
  // 6 base stripes) to match the fine filigree in reference renders instead of a few broad bands.
  float bands = fract(m * (10.0 + uTreble * 6.0));
  // 0.4 (original) pulled every mid-escape pixel up toward the same washed mid-grey/pink - nothing
  // in the frame got close to black, so the bright filigree had nothing dark to stand out against.
  // 0.65 was still too gentle a curve to read as real contrast; 1.35 (>1, so it now DARKENS mid
  // values instead of lifting them) is what actually separates "ground" from "lit edge".
  float shade = pow(m, 1.35);
  float glow = pow(1.0 - clamp(trap * 4.0, 0.0, 1.0), 1.4);

  // Orbit-trap ring texture: log(trap) runs roughly linearly with distance (in escape-time space)
  // from whatever mini-component z is skirting, so cosining it draws the concentric rings that
  // reference fractal-art renders are built from - the log keeps rings evenly spaced instead of
  // bunching near trap = 0 the way cosining the raw value would. Frequency raised from 5 to 8 so
  // the rings are actually resolvable as rings rather than reading as one soft glow.
  float logTrap = log(max(trap, 1e-5));
  float ring = 0.5 + 0.5 * cos(logTrap * 8.0 - uTime * 0.4);

  // uChaosPalette (3-5, re-rolled by Canvas.vue alongside the hue morph target) sets how many
  // anchors are in the chain; structure picks a position along it, so more anchors means more
  // distinct bands between ground and core, not more layers stacked up.
  float count = clamp(uChaosPalette, 3.0, 5.0);
  float structure = clamp(shade * 1.5 + bands * ring * 0.35 - 0.15, 0.0, 1.0);
  vec3 col = chaosMix(structure, count, 0.0);
  float hot = clamp(pow(glow, 2.0) * (1.0 - m) * 2.2, 0.0, 1.0);
  col = mix(col, chaosAnchor(count - 1.0, count, 0.0), hot);
  // A small near-white spark right at the hottest point - the pinprick every reference image has
  // at its spiral centre, which chaosColor() alone can't reach since hsv2rgb tops out at a
  // saturated hue. pow(hot, 4) keeps it tight to the true peak rather than washing out the core
  // anchor's own colour over a wide area.
  col = mix(col, vec3(1.0), pow(hot, 4.0) * 0.5);
  col *= 0.55 + 0.8 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

// One centred Julia kaleidoscope (a scattered-copies version, and then a horizontally-tiled
// version, were both tried and reverted - neither was wanted). The only difference from a plain
// single-fractal design is the normalisation: HEIGHT alone, not centered()'s shorter-edge
// normalisation, so the fractal is sized relative to the viewport's height and - on anything wider
// than square - naturally extends past the left/right edges rather than being shrunk to fit inside
// them. That's "overflowing the width, not the height": it's still one fractal, centred, just
// cropped by the viewport on a wide screen instead of scaled down to avoid being cropped. Six-fold
// polar folding into a kaleidoscope and orbit-trap glow for interior texture are unchanged.
//
// c no longer orbits a live circle - it walks Chaos's OWN precomputed boundary path
// (helpers/visualizer/juliaPath.ts), eased from one random point on it to another over a random
// 7-14s (Canvas.vue, mirroring CHAOS_MORPH_* exactly), so the shape "seamlessly transitions to
// another fractal" - the same way Chaos's colour morphs, just applied to the Julia constant instead
// of a hue. Unlike Chaos, Fractal WANTS an interior sometimes (that's what the orbit-trap glow is
// for), so walking through path points is fine even though a couple of intermediate frames of a
// straight interpolation could dip inside the set - a filled patch reads as a kaleidoscope petal
// closing up, not a bug.
const FRACTAL = `
void main() {
  // Normalised by HEIGHT alone, not centered()'s shorter-edge normalisation - see the comment
  // above. No wrapping/tiling: p.x runs unbounded past ±1 on a wide screen, so the fractal simply
  // continues past the viewport edge rather than repeating.
  vec2 p = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;
  p *= 1.35 - uBass * 0.35;
  p = rot2(uTime * 0.05) * p;

  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = 3.14159265 / 3.0;
  a = abs(mod(a + seg * 0.5, seg) - seg * 0.5);
  p = vec2(cos(a), sin(a)) * r;

  vec2 z = p;
  float esc = 0.0;
  float trap = 10000.0;
  for (int i = 0; i < 48; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uFractalC;
    trap = min(trap, dot(z, z));
    if (dot(z, z) > 16.0) {
      break;
    }
    esc += 1.0;
  }

  float dz = dot(z, z);
  float m = esc;
  if (dz > 16.0) {
    m = esc + 1.0 - log2(max(log2(dz), 1.0001));
  }
  m = clamp(m / 48.0, 0.0, 1.0);

  float bands = fract(m * 9.0);
  float shade = pow(m, 1.2);
  float glow = pow(1.0 - clamp(trap * 3.5, 0.0, 1.0), 1.4);
  float logTrap = log(max(trap, 1e-5));
  float ring = 0.5 + 0.5 * cos(logTrap * 7.0 - uTime * 0.35);

  float count = clamp(uChaosPalette, 3.0, 5.0);
  float structure = clamp(shade * 1.5 + bands * ring * 0.35 - 0.15, 0.0, 1.0);
  vec3 col = chaosMix(structure, count, 0.0);
  float hot = clamp(pow(glow, 2.0) * (1.0 - m) * 2.2, 0.0, 1.0);
  col = mix(col, chaosAnchor(count - 1.0, count, 0.0), hot);
  col = mix(col, vec3(1.0), pow(hot, 4.0) * 0.5);
  col *= 0.55 + 0.8 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

// z <- z^n + c, with n drifting continuously (Canvas.vue eases it A-to-B between random values the
// same idiom as every other morph in this file) so the set's symmetry order visibly changes over
// time rather than snapping between integers - the thing that makes this preset a distinct third
// Julia set next to Chaos's dendrite and Fractal's fixed six-fold kaleidoscope.
//
// The first cut computed z^n directly via polar form (r^n·cos nθ, r^n·sin nθ, i.e. atan2 + pow)
// INSIDE the iteration loop, once per step - the standard way to raise a complex number to a real
// power, and mathematically correct. It still had to be reverted: atan2 has a genuine branch-cut
// discontinuity at theta = ±π, and re-deriving z^n via atan2 on every single iteration re-triggers
// that cut every step - across 48 compounding iterations, adjacent pixels that started a hair's
// width apart can end up on opposite sides of the cut at different steps and diverge completely,
// which read as literal tears/cuts sheared across the whole frame, not the hoped-for organic
// filigree. There is no smooth fix for that: a genuine fractional complex power inherently has a
// branch cut, full stop - it is not a bug in the formula, it is what the operation IS.
//
// The fix is to stop computing a genuinely fractional power at all. zpow() below raises z to an
// INTEGER power via repeated complex multiplication - pure polynomial, no atan anywhere, hence no
// branch cut, hence no seam, ever, at any power. juliaField() runs the full escape iteration once
// at floor(n) and once at ceil(n) - two clean, independent, cut-free renders one integer apart -
// and main() cross-fades their escape/trap FIELDS by fract(n). This does not compute a literal
// z^5.5; it draws two real, valid Julia sets (power 5 and power 6) and blends how brightly each
// pixel reads between them, which is the standard real-time technique for animating a Multibrot's
// power and is visually indistinguishable from a true continuous morph, with none of the artifact.
//
// c used to orbit a live circle every frame (bass nudging the angle, mid the radius), with no
// validation of where that orbit actually put it - and the circle's radius (0.35-0.8) turned out
// to sit squarely in the regime where a Julia set is mostly interior (c=0 is the exact unit disk,
// entirely interior; every |c| that small stays close enough to that regime that huge connected
// areas of the frame land inside the filled set), which is what produced the reported "one flat
// colour fills the screen" bug. `c` is now picked and validated on the CPU instead -
// helpers/visualizer/juliaField.ts's pickJuliaTarget(), the same idea as Chaos/Fractal's boundary
// path (juliaPath.ts) but adapted to Julia's own iteration and probing several points across the
// visible frame rather than one curve, since Julia's z starts at the pixel's own position, not
// always the origin the way a Mandelbrot-style search assumes - see that file's own header for the
// full numeric story. `uJuliaSetC` is that picked value, eased A-to-B between successive targets
// in Canvas.vue exactly like Chaos's hue or Fractal's own `c`. The view itself is also tighter than
// the original 1.3 (now a fixed 0.35, JULIA_VIEW_SCALE in juliaField.ts, which the picker validates
// against) - a Julia set only reads as filigree when framed fairly closely around the boundary,
// same reason Chaos's own zoom is "0.5x to 5x" rather than one flat wide shot. Escape-count
// shading, the orbit-trap ring and the shared chaosMix() palette are the identical recipe
// Chaos/Fractal already prove.
const JULIA = `
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// z^power via repeated multiplication - power is always a small compile-time-unknown but
// runtime-bounded int (2-6, see main()), so a fixed chain of "if (power >= k)" is cheaper and
// simpler than a dynamically-bounded loop for a range this small, and unlike a loop needs no
// break/continue at all.
vec2 zpow(vec2 z, int power) {
  vec2 r = z;
  if (power >= 2) { r = cmul(r, z); }
  if (power >= 3) { r = cmul(r, z); }
  if (power >= 4) { r = cmul(r, z); }
  if (power >= 5) { r = cmul(r, z); }
  if (power >= 6) { r = cmul(r, z); }
  return r;
}

// Escape field for z <- z^power + c starting at p. Returns (smooth escape 0-1, orbit trap) packed
// into one vec2 so main() can call this twice (floor/ceil power) without needing GLSL out-params.
vec2 juliaField(vec2 p, vec2 c, int power) {
  vec2 z = p;
  float esc = 0.0;
  float trap = 10000.0;
  for (int i = 0; i < 36; i++) {
    z = zpow(z, power) + c;
    trap = min(trap, dot(z, z));
    if (dot(z, z) > 16.0) {
      break;
    }
    esc += 1.0;
  }
  // Generalised smooth escape count: the power-2 formula (esc + 1 - log2(log2(dz))) divides by
  // log2(2) = 1 implicitly, so dividing by log2(power) is what keeps the falloff smooth at every
  // integer power this is actually called with.
  float dz = dot(z, z);
  float m = esc;
  if (dz > 16.0) {
    m = esc + 1.0 - log2(max(log2(dz), 1.0001)) / log2(float(power));
  }
  return vec2(clamp(m / 36.0, 0.0, 1.0), trap);
}

void main() {
  // 0.35, not the original 1.3 - see the comment above const JULIA. Must match
  // JULIA_VIEW_SCALE in helpers/visualizer/juliaField.ts exactly: that's the view the CPU picker
  // validates a candidate c against, so a mismatch here would render a frame nobody checked.
  vec2 p = centered() * 0.35;
  p = rot2(uTime * 0.04) * p;

  float n = clamp(uJuliaPower, 2.0, 6.0);
  vec2 c = uJuliaSetC;

  int powerLo = int(floor(n));
  int powerHi = int(min(ceil(n), 6.0));
  vec2 fieldLo = juliaField(p, c, powerLo);
  vec2 fieldHi = juliaField(p, c, powerHi);
  float blend = fract(n);
  float m = mix(fieldLo.x, fieldHi.x, blend);
  float trap = mix(fieldLo.y, fieldHi.y, blend);

  float bands = fract(m * (8.0 + uTreble * 5.0));
  float shade = pow(m, 1.25);
  float glow = pow(1.0 - clamp(trap * 3.5, 0.0, 1.0), 1.4);
  float logTrap = log(max(trap, 1e-5));
  float ring = 0.5 + 0.5 * cos(logTrap * 6.0 - uTime * 0.3);

  float count = clamp(uChaosPalette, 3.0, 5.0);
  float structure = clamp(shade * 1.5 + bands * ring * 0.3 - 0.15, 0.0, 1.0);
  vec3 col = chaosMix(structure, count, 0.0);
  float hot = clamp(pow(glow, 2.0) * (1.0 - m) * 2.2, 0.0, 1.0);
  col = mix(col, chaosAnchor(count - 1.0, count, 0.0), hot);
  col = mix(col, vec3(1.0), pow(hot, 4.0) * 0.5);
  col *= 0.55 + 0.8 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

// Flow: a domain-warped fBm plasma, Winamp/MilkDrop-reminiscent - deliberately the one preset here
// NOT built on Mandelbrot/Julia escape-time maths, so it doesn't compete with Chaos/Fractal/Julia's
// shared "spiraling dendrite" look. Replaces the old Buddhabrot preset (a multi-pass GPU histogram
// accumulator, helpers/visualizer/buddhabrot.ts, deleted) outright - that preset's own single-pass
// fallback shader read as visually weak even after its bugs were fixed, so rather than keep
// investing in another fractal-family preset this is a different subject entirely.
//
// A single fbm layer reads as static mottled clouds - no motion, just texture. WARPING the sample
// coordinates by a second fbm field before sampling a third time (the classic
// `p = fbm(p + fbm(p + ...))` trick) is what turns that into something that reads as continuously
// FLOWING: each octave's warp itself drifts over time, so the whole field never resolves into a
// fixed texture merely panning underneath the camera.
//
// Same house rule as Chaos/Fractal/Julia: camera motion (swirl/zoom below) is uTime-only, NEVER
// audio-driven - folding a beat into camera position reads as the screen jumping, not the music.
// uBass/uMid/uTreble/uLevel only ever touch shading/turbulence-strength/brightness, and gently -
// see the turbulence/hot comments below for why those coefficients are kept small. This preset sits
// fullscreen with hard motion for as long as it's open, so it deliberately favours a calmer,
// non-strobing feel over a punchier one: no full-field brightness pulsing, no hard edges that could
// flash on a beat.
//
// uFlowSeed (Canvas.vue's flowSeed) is a slow continuous orbit through noise-space, not a
// hold-then-jump reroll - an earlier version held it still for 20-40s then eased to a fresh random
// point, which read as "static for a while, then a fast jarring slide to a different scene, then
// static again" (the exact failure Buddhabrot's own sampled-region comment already warned about:
// hold-then-jump reads as a slideshow, continuous sweep reads as alive). A slow perpetual orbit has
// no jumps to begin with, so there is nothing to read as a seizure-inducing flash.
const FLOW = `
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5 octaves - one more than the original 4, for busier/more chaotic detail (per request: the
// vortex read as "boring", and one more octave of fine filigree costs little for a single preset).
// The 2.02 (not 2.0) per-octave scale and the +17.0 offset keep successive octaves from lining up
// into a visible repeating lattice.
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    sum += amp * vnoise(p);
    p = rot * p * 2.02 + 17.0;
    amp *= 0.5;
  }
  return sum;
}

// Two-layer domain warp, sampled at whatever coordinate/zoom the caller hands it - kept as its own
// function because main() below samples it TWICE (see the zoom crossfade) and needs both calls to
// stay identical. The warp multiplier (2.4) amplifies how much the warp bends the sampled
// coordinate - turned back up from an earlier, more conservative 1.6 per request for a busier,
// more chaotic field (the earlier value existed to tame how violently AUDIO-linked turbulence
// could swing the field frame to frame - see turbulence's own comment - not to cap the field's
// baseline complexity, which is purely uTime-driven and can run as hot as looks good).
float flowField(vec2 q) {
  // Internal drift, 4x an earlier version's speed (per request) - the warp itself keeps evolving
  // even where the camera briefly isn't moving much (e.g. near the swirl's own centre), which is
  // what keeps every part of the frame reading as alive.
  float drift = uTime * 0.06;
  vec2 warpA = vec2(fbm(q + drift), fbm(q + vec2(5.2, 1.3) - drift));
  // Barely-there, on purpose: unlike Chaos's chaotic dendrite (where a warp-strength nudge blends
  // into texture that's already busy everywhere), Flow renders ONE clean, singular, instantly-
  // readable vortex - so ANY change to the warp strength is a change to the vortex's own visible
  // geometry, not just its texture. An earlier version modulated this by up to +25%/+15% off
  // mid/treble (the same order of magnitude Chaos/Fractal use for THEIR audio touches) and the
  // whole spiral visibly bulged/deformed in sync with the beat - "twerking" - because there's only
  // one shape on screen for that deformation to show up in. Cut an order of magnitude.
  float turbulence = 1.0 + uMid * 0.025 + uTreble * 0.015;
  vec2 warpB = vec2(
    fbm(q + 2.4 * warpA * turbulence + vec2(1.7, 9.2)),
    fbm(q + 2.4 * warpA * turbulence + vec2(8.3, 2.8))
  );
  return fbm(q + 2.4 * warpB);
}

void main() {
  // Swirl: a spiral vortex, not a rigid spin - rotation strengthens toward the centre (1.1 / r) so
  // the field looks genuinely stirred. Precession speed 4x an earlier version's (per request - it
  // read as "a very very slow vortex, boring"). Floored well above 0 (not the usual tiny
  // anti-division-by-zero epsilon) - an unfloored 1/r winds the angle towards infinity as r->0,
  // which wound the centre into an ultra-tight bullseye of rings a couple of pixels wide. Noise
  // sampled that densely aliases (no mipmapping on a procedural field), so that patch shimmered on
  // its own regardless of audio - and it's exactly where the "hot" highlight below sits, compounding
  // it. Flooring at 0.25 caps the extra winding at ~4.4 radians - still a multi-turn spiral, not a
  // point singularity.
  //
  // A second, faster, radius-dependent wobble (0.6*sin(...)) is layered on top - a single uniform
  // rotation rate is one big smooth vortex and nothing else, which is exactly the "boring" being
  // complained about here; a term that oscillates over time AND varies with radius breaks the
  // spiral into shifting, uneven eddies instead of one rigid pinwheel, without ever being a
  // discontinuous jump (sin() is smooth everywhere) or audio-linked (still pure uTime/position, so
  // it can't reintroduce beat-synced "twerking").
  float r = length(centered()) + 0.25;
  float swirl = uTime * 0.08 + 1.1 / r + 0.6 * sin(uTime * 0.15 + r * 3.0);
  vec2 sp = rot2(swirl) * centered();

  // Perpetual zoom-IN, forever, via a 2-sample cross-fade one octave of zoom apart: uv2 at the end
  // of a cycle (f -> 1) is bit-for-bit the same coordinate uv1 starts the NEXT cycle at (f -> 0), so
  // the sampled field is continuous straight through the wrap - no pop, no jump, just an endless
  // slow dive, the "slightly zooming in infinitely" this preset is going for without the float32
  // precision blowup a real one-way zoom would eventually hit. Cycle speed 4x an earlier version's,
  // same request as the swirl above.
  float cycle = uTime * 0.072;
  float f = fract(cycle);
  // uFlowSeed is added to BOTH samples identically, after the *2.0 - not added once and then
  // doubled along with the rest of uv1, which was the actual bug in an earlier version: doubling
  // the seed term along with the coordinate broke the exact continuity this whole trick depends on,
  // producing a real (if brief, every ~56s) discontinuity that read as a flash.
  vec2 base = sp * pow(2.0, -f);
  vec2 uv1 = base + uFlowSeed;
  vec2 uv2 = base * 2.0 + uFlowSeed;
  float field = mix(flowField(uv1), flowField(uv2), f);

  float count = clamp(uChaosPalette, 3.0, 5.0);
  // No pow() contrast-reshaping and no hard fract() banding here (an earlier version had both) -
  // fbm's output doesn't cluster near a cap the way escape counts do, and a fract()-based band is a
  // sawtooth with a hard seam every wrap: any pixel near that seam flips between two very different
  // colours from one frame to the next as the field drifts past it, which is exactly the kind of
  // fast hard-edged flicker a photosensitive viewer reacts to. A smooth field with no seams reads as
  // a slow-flowing gradient instead.
  float structure = clamp(field, 0.0, 1.0);
  vec3 col = chaosMix(structure, count, 0.0);
  // Bass nudges the hot highlight only slightly (+/-8% around a 0.5 base - down from an earlier
  // +/-25%, same reasoning as turbulence above: the vortex's centre is a single unmistakable focal
  // point, so pulsing its brightness hard enough to notice reads as the whole shape throbbing, not
  // a subtle accent).
  float hot = clamp(pow(field, 4.0) * (0.5 + uBass * 0.08), 0.0, 1.0);
  col = mix(col, chaosAnchor(count - 1.0, count, 0.0), hot);
  col = mix(col, vec3(1.0), pow(hot, 4.0) * 0.4);
  // A gentler brightness range than Chaos/Fractal/Julia's shared 0.55-1.35 (uLevel=0..1) - same
  // reasoning again: this preset is one coherent field filling the whole frame, so a big overall
  // brightness swing on the music's loudness envelope reads as the entire image "pumping" with the
  // beat rather than a subtle glow response.
  col *= 0.75 + 0.4 * uLevel;
  gl_FragColor = vec4(col, 1.0);
}
`

export const FRAGMENT_SHADERS: Record<VisualizerPresetId, string> = {
  chaos: PRELUDE + CHAOS,
  fractal: PRELUDE + FRACTAL,
  flow: PRELUDE + FLOW,
  julia: PRELUDE + JULIA,
}
