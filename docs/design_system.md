# Design system

Tracks the UI overhaul in progress. Updated stage by stage — see the plan for the full
breakdown; this doc describes what has actually landed, not what's planned.

## Layers

```
web/assets/css/theme.css         generated design data — colour ramps, type scale, radii, shadows
web/assets/css/legacy-theme.css  pre-overhaul tokens, kept until every page migrates off them
web/assets/css/main.css          imports + base layer (resets, keyframes, the two @utility
                                 replacements for what used to be component <style> blocks)
web/helpers/ui.ts                recipe layer: typed Tailwind utility-string builders
```

### `theme.css` — tokens

`@theme static` block, six colour ramps (`stone`, `amber`, `green`, `orange`, `red`, `violet`,
each `50`→`950`) plus six semantic aliases that name a decision rather than a value: `accent`,
`on-accent`, `success`, `warning`, `danger`, `info`. Also the type scale (`--text-2xs`…
`--text-4xl`), radii (`--radius-sm`…`2xl`) and elevation (`--shadow-md/lg/xl/accent`).

`static` matters: it forces every token to also exist as a real custom property at runtime, so
`getComputedStyle` reads `var(--color-amber-400)` correctly from the non-Tailwind rendering
surfaces in the app — Leaflet (`pages/labs/map.vue`), d3 (`genome.vue`, `network.vue`) and
Chart.js (`decades.vue`) all read colours out of the theme this way once their stage lands,
instead of hard-coding a hex/oklch literal that drifts from the token.

Never hand-edit `theme.css`'s values without updating this doc — there is no separate generator
for it in this codebase (unlike the reference design handoff this system was seeded from); the
file itself is the source of truth.

### `legacy-theme.css` — transition scaffolding

The token set every page used before the overhaul (`bg-bg`, `text-ink`, `border-rule`, DM Sans,
etc.), moved verbatim out of `main.css` so `theme.css` can be imported after it. Two names
collide on purpose — `--color-accent` and `--font-sans`/`--font-display` — and because the later
`@import` wins, the whole app got the new brand colour and typeface immediately, before a single
page was touched. Every other legacy token keeps resolving until the page using it is migrated.

Deleted whole once no page references it. Grep for `bg-bg\b|text-ink\b|border-rule|accent-soft|
accent-ink|rounded-cover|shadow-play|shadow-ring-accent|text-card-|text-meta|text-hero-stat|
text-mag-title|spacing-sidebar` to check what's left.

### `main.css` — base layer

Import order (`@import` must precede all other rules, so both legacy and new theme files are
imported before anything else):

```css
@import "tailwindcss";
@import "./legacy-theme.css";
@import "./theme.css";
```

Everything after that is hand-written CSS, and everything here is either a base-element reset
(link/selection/focus-visible colours, ground background/text/font on `html,body`) or a
`@utility`/keyframe that replaces what used to be a component-local `<style scoped>` block:

- `animate-highlight-flash` / `animate-spin-slow` — shared animation utilities.
- `genre-border` — the animated conic-gradient border for genre/region playlists. One
  definition; replaces the two copies in `components/playlist/Block.vue` and
  `pages/playlists/[slug].vue` (the latter referenced an undefined `--color-surface`, so its
  border rendered with a transparent inner layer — fixed by removing the copy).
- `.leaflet-container` / `.leaflet-control-zoom a` — Leaflet doesn't take Tailwind classes, so
  its chrome is themed globally instead of in `pages/labs/map.vue`'s own `<style>` block.
- A `prefers-reduced-motion: reduce` block that neutralises transitions/animations app-wide.

**The `<style scoped>` blocks in `playlist/Block.vue`, `pages/playlists/[slug].vue` and
`pages/labs/map.vue` still exist right now** — they're removed once those specific pages are
restyled (their stage deletes the local copy in favour of the shared utility above). Until then
`CLAUDE.md`'s exception list is still accurate.

### `helpers/ui.ts` — recipes

Hand-written, typed Tailwind utility-string builders — not a port of any external tool. Only
patterns that repeat in this app get a recipe; a one-off stays inline utilities at the call
site and only gets promoted here the second time it repeats.

- `cx(...)` — joins truthy class fragments.
- `button(variant, size, extra, on)` — every `<button>` in the app. Variants
  `primary | secondary | quiet | danger | ghost`, sizes `sm 30px | md 34px | lg 40px`.
- `sw(key, on)` — the same idle/on pattern for non-button toggles (`tab`, `chip`, `keyChip`,
  `switchBtn`, `countPill`, `underTab`).
- `toneText` / `toneBg` / `toneFill` — the one status/severity→colour map (`accent`, `success`,
  `warning`, `danger`, `info`, `muted`). Consumed by `helpers/constants.ts`'s `statuses[]` and
  `scoreRanges[]` — see the next stage of the overhaul for where those retire their duplicates.
- `surface`, `form`, `nav`, `data`, `grid`, `tile`, `typography`, `layout` — smaller namespaces
  for cards, inputs, table cells, catalogue tiles, headings and page chrome.
- `ui` — a single bundle of all of the above, for `ui.card` / `ui.form.input` call-site
  ergonomics; the named exports are the source of truth if a component only needs one namespace.

**Why `idle`/`on` are never combined with a class-string helper alone:** Tailwind resolves two
utilities that touch the same CSS property by *stylesheet order*, not by which one appears later
in a `class` attribute. `bg-stone-800 bg-amber-400/20` does not reliably render as amber just
because it's written second. Every recipe with a toggle state (`button`'s `on` argument, every
entry in `sw`) is built as a `{ structural, idle, on }` triple so the idle and on colour classes
are mutually exclusive strings — one or the other is emitted, never both. `test/helpers/ui.test.ts`
asserts this holds for every variant and every toggle key.

## Quality bar

Applied to every primitive as it's rewritten (see the overhaul plan's Stage 1 onward for the
per-component checklist): full idle/hover/focus-visible/active/disabled/loading state coverage,
a real accessibility contract (focus trap + Escape + restore on dialogs, `role`/`aria-*` on every
custom control, visible focus ring never removed, live regions for async status), 4.5:1 text
contrast / 3:1 for large text and UI borders, motion capped at 150ms colour / 300ms width and
gated behind `prefers-reduced-motion`, and `data-testid` on anything a spec needs to reach
reliably.

`test/unit/theme.test.ts` enforces the token half of that bar mechanically: every ramp has all
11 steps and is monotonically ordered light→dark, every semantic alias resolves, and the actual
colour pairs the app renders (primary/secondary/tertiary text on the page and card surfaces,
on-accent on accent, each status tone on the page surface) are checked against real WCAG
contrast ratios — not eyeballed. `test/helpers/colorMath.ts` holds the OKLCH→sRGB conversion and
contrast-ratio maths those checks run on; it isn't shipped app code.

## Adding to the system

- **New colour, radius, shadow or type size** → it's a token discussion, not a one-off. Add it
  to `theme.css` and update the ramp/alias tests in `theme.test.ts`.
- **A Tailwind utility string that now appears in a second component** → promote it to
  `helpers/ui.ts`, in the namespace it belongs to (or a new one, named for what it is, not where
  it's used).
- **Everything else** → inline Tailwind utilities at the call site. Don't create a recipe for
  something used once, and don't write a component `<style>` block — if a screen needs something
  Tailwind utilities genuinely can't express, it becomes a `@utility` in `main.css` instead, same
  as `genre-border` above.
