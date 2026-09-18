# Visualizer

Fullscreen WebGL visualizer over playback.

- Open: player-bar icon, Explore header, `v` key. Close: `Esc`.
- 4 fragment-shader presets: **chaos, fractal, flow, julia**. Switch: HUD, `1`-`4`, `n`.
- Registered in `helpers/constants.ts` `visualizerPresets` (id/label/description/key) — add/rename a preset by touching only that file + its shader/uniform wiring.
- `decodeVisualizerPreset` falls back to `chaos` for unknown `localStorage['dmp-visualizer']`.
- **Rule: one compiled program, one fullscreen triangle, one draw call per preset.** No non-default framebuffer/blend state. (Old Buddhabrot preset broke this with a multi-pass GPU histogram accumulator — removed as visually weak even bug-free, replaced by Flow.)

## Chaos / Fractal / Julia — all Julia sets, deliberately distinct

- **Chaos**: `c` searched CPU-side per frame (`helpers/visualizer/juliaPath.ts`) to sit just outside the Mandelbrot boundary (dendrite, not interior blob) — steps along the cardioid's outward normal then bisects an escape-count window. (Bug fixed: radial cardioid scaling landed inside the period-2 bulb.) Camera (zoom/spin) is audio-blind by design — jump-scale-on-kick tried and rejected. Colour: CPU hue morph (`helpers/visualizer/hueMorph.ts`, random target every 5-9s) → `uChaosHue` → 3-5 palette anchors (`uChaosPalette`) mixed by `chaosMix()` (shared `PRELUDE`), keyed on escape depth/trap proximity. Fractal/Julia/Flow reuse this palette state for continuity across switches.
- **Fractal**: fixed 6-fold polar-fold kaleidoscope, orbit-trap glow, normalised by viewport height only (extends past L/R edges on wide viewports — scattered/tiled variants tried, reverted). `c` eases between two random points on Chaos's boundary path over 7-14s. Only preset reading `uBass` directly, gated through `isBeat()` (`helpers/audioBands.ts`, ratio-over-baseline + absolute floor) — jumps once per beat after a 5-9s freeze window, not every kick.
- **Julia**: `z <- z^n + c`, `n` drifts between validated targets. `zpow()`/`juliaField()` computes `floor(n)`/`ceil(n)` via repeated complex multiplication (no `atan2`, no branch-cut tearing — original polar approach tore frames) and cross-fades by `fract(n)`. `c`+`n` jointly validated by `pickJuliaTarget()` (`helpers/visualizer/juliaField.ts`, grid-probes visible frame since Julia's `z` starts at pixel position — a plain live-orbiting `c` sat in the interior regime, flat-colour blob). View: `JULIA_VIEW_SCALE=0.35`, `c` radius `[0.75,1.05]`. Target holds 5-12s then eases, plain timer (no beat-gating, tried and removed).

## Flow (`FLOW` in `helpers/visualizer/shaders.ts`)

Not Mandelbrot/Julia escape-time — domain-warped fBm plasma, Winamp/MilkDrop-style, so it doesn't compete with the other three's "spiraling dendrite" look.

- `p = fbm(p + fbm(p + ...))` — warping sample coords by a second fbm field before a third sample is what reads as *flowing* vs. a single fbm layer (static mottled clouds) or a texture merely panning.
- 4 octaves, `vnoise()` (value noise on shared `hash()`), fixed per-octave rotation + off-integer scale (`2.02` not `2.0`) so octaves don't align into a lattice.
- Camera motion (swirl+zoom) is `uTime`-only, never audio-driven — same rule as Chaos/Fractal/Julia, most likely to regress. `uMid`/`uTreble` scale warp *strength* only (+25%/+15% max). `uBass` nudges hot-highlight strength (±25% around 0.5 base). None touch position.
- Colour: same `chaosMix()`/`chaosAnchor()` pipeline, keyed on fbm value directly — no `pow()` contrast reshaping, no `fract()` banding (a fract band flickers hard between two colours as the field drifts — was the biggest cause of an early strobe-like read).
- Camera = spiral swirl (`rot2(uTime*0.02 + 1.1/r)`, stronger near centre) + perpetual zoom-in via 2-sample cross-fade one octave apart (`uv2 = uv1*2.0`, blended by `fract(uTime*0.018)`) — `uv2` at cycle end == `uv1` at next cycle start, so field is continuous through the wrap: endless dive, no pop, no float32 blowup.
- `uFlowSeed` (`Canvas.vue`'s `flowSeed`): continuous orbit (`cos/sin(clock * FLOW_SEED_SPEED) * FLOW_SEED_RADIUS`, ~2600s period) through noise-space. Deliberately not hold-then-jump (earlier version did — read as "static, then a jarring slide"). Continuous orbit = no jumps = nothing to read as a seizure flash.

## Misc

- Web Audio tap is one-shot/permanent: `composables/useAudioAnalyser.ts` module-level `AudioContext`/`MediaElementAudioSourceNode`/`AnalyserNode` singletons. `createMediaElementSource()` throws on 2nd call per element → no `dispose()`, source stays connected to `ctx.destination` (else app-wide silence). Graph built lazily on first visualizer open.
- `stores/player.ts`'s `getAudioElement()` is `null` until first playback → toggle gated on `player.currentTrack`.
- Overlay is teleported `fixed inset-0`, not `useChrome().hide()` — must stack above Explore cinema mode; `requestFullscreen` needs a real element; iOS Safari rejects it on non-`<video>` → CSS-only fallback + own Escape handling.
- `prefers-reduced-motion` damped in `Canvas.vue`'s clock — `main.css`'s reduced-motion block can't reach a rAF loop.
