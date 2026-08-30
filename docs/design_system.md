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

## Control primitives (Stage 1)

Rewritten on the recipes above, same component names and props so call sites were untouched
except where the API itself changed:

- `components/ui/Button.vue` — variants `primary | secondary | quiet | danger | ghost`, sizes
  `sm | md | lg`, a new `on` prop for toggle-style buttons (routed through `button()`),
  `aria-busy` while loading, `aria-pressed` when `on` is set.
- `components/Dialog.vue` / `ConfirmDialog.vue` — scrim + panel, `role="dialog"
  aria-modal="true"` with the title as `aria-labelledby`, focus trap + focus restore
  (`composables/useFocusTrap.ts`), Escape to close, body scroll lock. Fixed the `maxWidth` map
  (`md` used to render `max-w-lg`, keyed one size off from its own name).
- `components/Switch.vue` — 34×19 track, 15px knob, `role="switch"` unchanged.
- `components/Slider.vue` — rebuilt as a custom `role="slider"` control (rail/knob divs, pointer
  drag with pointer capture, arrow/Home/End keys, full aria value attributes) replacing a styled
  native `<input type="range">`. Same props (`modelValue`, `min/max/step`, `leftLabel`,
  `rightLabel`, `title`, `stops`, `hint`).
- `components/RadioGroup.vue` — segmented control, `role="radiogroup"` + roving-tabindex
  `role="radio"` items, arrow/Home/End keys.
- `components/Dropdown.vue` / `ButtonDropdown.vue` — `aria-haspopup`/`aria-expanded` on the
  trigger, `role="listbox"`/`"menu"` panel, Escape closes and returns focus to the trigger.
  Outside-click still closes via the pre-existing full-screen backdrop `<div>` technique, not
  `@vueuse/core`'s `onClickOutside` — see the SSR note below for why that swap was reverted.
- `components/Popover.vue` — unchanged click/hover/backdrop behaviour, now also closes on
  Escape while open.
- `components/Tabs.vue` / `Subtabs.vue` — `role="tablist"`/`"tab"`, roving tabindex, arrow/Home/End
  move focus among tabs (manual-activation pattern: arrow keys move focus, they don't themselves
  select). `Subtabs` no longer hard-codes `border-blue-500 text-white` as its default active
  colour.
- `components/ui/Checkbox.vue` (new) — real `<input type="checkbox">` under a styled overlay
  (`form.checkbox`), supports `indeterminate` (a DOM property, not an attribute — set imperatively
  via `watchEffect`, see the component for why).
- `components/ui/EmptyState.vue` (new) — icon + message + optional hint + action slot. Existing
  ad-hoc empty states get migrated onto it page by page, not in this stage.
- `components/Skeleton.vue` — deleted (zero consumers; `release/Skeleton.vue` is the one actually
  used).

### SSR safety: `document`/`window` access must never be unconditional

Every one of these primitives is a plain SFC that Nuxt renders on the **server** too. `document`
and `window` don't exist there. The bug this caught: `Dialog.vue`'s first draft wired Escape/
scroll-lock through `watch(isOpen, ..., { immediate: true })` — `immediate` runs the callback
*synchronously at the `watch()` call site*, which is during `setup()`, which runs on the server.
Even the "closed" branch touched `document.removeEventListener`, so **every** page rendering a
closed dialog would have crashed SSR. No component test caught it, because `mountSuspended`
always mounts into a live (happy-dom) DOM — there is no `window`/`document` missing to trip over.
Caught only by grepping the rendered output for the crash after the fact.

The fix, and the pattern every later stage should reuse: split the effect into two entry points.
`onMounted(() => { if (active) applyEffect() })` handles "already active on first render" — safe
because `onMounted` is a purely client-side hook, never called during SSR. A **non-immediate**
`watch(active, applyEffect)` handles every later toggle — safe because reactive state can't
change during a single synchronous SSR pass, so a non-immediate watcher simply never fires there.
`useFocusTrap` and every dropdown/popover above follow this shape. `@vueuse/core`'s
`onClickOutside` was tried for Dropdown/ButtonDropdown and reverted: making it work at all
required passing an explicit `{ window }` option, and a bare top-level `window` reference in
`<script setup>` throws `ReferenceError: window is not defined` the moment that line runs on the
server - a second, worse instance of the same bug. The existing full-screen backdrop `<div>`
technique (already used everywhere else in this app) has no such risk, since it never touches a
global directly.

Grep any new interactive component for `document\.|window\.` before considering it done, and
confirm every hit sits inside `onMounted`, a non-immediate `watch` callback, or an event-handler
function body - never at the top level of `<script setup>` and never inside `{ immediate: true }`.

## Data primitives + the one status map (Stage 2)

**One table lineage.** The app had three: div-based `Table`/`TableRow`, real-`<table>`
`SlimTable*`, and `statistics/StatPage.vue`'s own inline table. Consolidated on the real
`<table>` lineage — semantic, keeps Playwright's `locator('tr')` assertions working
(`e2e/downloads.spec.ts`), and plays better with `<th>`/`aria-sort` than a div grid does.

- `components/DataTable.vue` (new) — a generic component (`<script setup generic="T extends
  object">`) built from `SlimTable`/`SlimTableHeader`/`SlimTableBody`/`SlimTableRow` +
  `SortableTh` + the new `Checkbox`/`EmptyState`. Handles column config, sort (delegated to the
  caller — `DataTable` emits `sort` with the clicked key and renders whatever `sort` prop it's
  given; it does not re-order `rows` itself, matching how `IssueTable.vue` and the browse/issues
  stores already own sorting), row selection (`selected: Set<string|number>` in, `update:selected`
  out — the exact shape `IssueTable`/`ApprovalQueue`/`MonitoringTab`/`HistoryContent` already use,
  so migrating those onto `DataTable` in their own stage needs no state-shape change), an inline
  bulk-action bar, a scoped `#actions` slot, per-column `#cell-{key}` scoped slots (falling back to
  the raw value), a loading skeleton, and an empty state via `EmptyState`.
- `SlimTable`/`SlimTableHeader`/`SlimTableBody`/`SlimTableRow`/`SortableTh` — retokenised, kept as
  the low-level pieces (`TrackList.vue` needs row-level control `DataTable` doesn't expose).
  `SortableTh` now sets `aria-sort` on the `<th>` itself, not just a visual chevron.
  `SlimTable`'s card is `overflow-x-auto overflow-y-hidden` with the table free to exceed the
  container width, so a wide column set stays reachable by scrolling instead of being clipped —
  clipping both axes would silently cut off whichever columns land last (status, actions).
- **`Table.vue`/`TableRow.vue` were NOT deleted this stage**, despite the original plan calling for
  it. They're still live in three places: `favorites/TrackTable.vue`, `playlist/TrackTable.vue`
  (genuine div-based pseudo-tables) and `downloads/ApprovalQueue.vue` (which only uses `Table.vue`
  as a card-styling wrapper around its own hand-rolled real `<table>` — not a structural
  conflict). Migrating those is folded into their own page stages (7 and 12) rather than done
  ahead of schedule here; deleting the two components now would have meant either breaking those
  pages or doing Stage 12's status-colour reconciliation early. `TableHeader.vue`/`TableBody.vue`
  had zero consumers and are deleted.
- `components/Block.vue` — the catalogue tile, retokenised (drops `rounded-cover`,
  `text-card-title`, `text-card-artist`, `text-meta`, `shadow-play`).
- `components/TrackList.vue` — retokenised throughout; its private `statusConfig` (missing
  `MISSING_TRACKS`, so that status silently fell through to no badge at all) is gone in favour of
  `<ReleaseStatusBadge>`.

**One status map.** `helpers/constants.ts`'s `statuses[]` now carries `tone` (one of
`helpers/ui.ts`'s six tones) instead of a hand-written class string, and is the only place release
status maps to a colour — `release/StatusBadge.vue` and `artist/StatusChips.vue` both read it via
`toneBg`/`toneFill`. `release/StatusMulti.vue` (zero consumers) is deleted.
`test/helpers/constants.test.ts` asserts the map is exhaustive over `ReleaseStatus`, every tone
resolves in all three tone maps, weights are distinct and ascending (worst-status rollups depend
on this), and no non-`UNKNOWN` status shares `muted` with the "nothing to report" state.

`scoreRanges[]` (the five match-score bands) keeps its original `{min,max,label,color,textColor,
bgColor}` shape — unlike `statuses[]`, five bands need more granularity than the six semantic
tones give a single value, so it walks the red→orange→amber→green ramps directly rather than
going through a tone. Only the ramp-step values changed (old raw `bg-red-500`/`bg-accent`/
`bg-emerald-500` → `bg-red-400`/`bg-amber-400`/`bg-green-500`); the shape is untouched so its two
current consumers (`browse/FilterScore.vue`, `artist/AverageMatchScore.vue`, both un-migrated
until their own stage) don't need a second change later.

## Application shell (Stage 3)

`components/layout/*`, `layouts/*`, `error.vue`, `components/terminal/*`,
`components/player/{AudioPlayer,PlayPauseButton}.vue`, `components/ToggleFavorite.vue` —
retokenised, plus:

- **`components/layout/SidebarItem.vue` (new)** replaces `Sidebar.vue`'s four copy-pasted
  nav-link blocks (three links + a sign-out button, each with its own active-rail markup) with
  one component driven by a `NavEntry[]` list, used for both the primary and footer nav groups.
  Sets `aria-current="page"` on the active link and `title`/`aria-label` when collapsed (a
  collapsed icon-only item had neither before).
- **A real bug found while rewriting `useSidebar.ts`**: its width watcher forced
  `collapsed = width <= 720` on every resize, including ones after the user had manually expanded
  the sidebar while the window happened to be narrow — the next resize (even a 1px change from a
  scrollbar appearing) silently snapped it back closed. Fixed with a `sidebar-manually-set` flag:
  once the user toggles, their choice wins over the width default for the rest of the session.
  Covered by a new test in `test/composables/useSidebar.test.ts`.
- **`components/layout/SearchBar.vue` + `SearchDropdown.vue`** gained the ARIA combobox
  contract: `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-activedescendant` on the
  input, `role="listbox"`/`"option"` on the dropdown, and ArrowUp/ArrowDown/Enter/Escape keyboard
  navigation across all three result sections (artists → releases → tracks) as one flat list —
  previously mouse-only. `SearchDropdown` exposes `flatEntries` via `defineExpose` so `SearchBar`
  can count total results and read a route to navigate to on Enter without duplicating the
  route-building logic in two places.
- **`components/layout/AppShell.vue`** gained a skip-to-content link (`#main-content`, the page
  slot's new `<main>` landmark) — previously the sidenav was ~12 tab stops ahead of the page on
  every route with no way to jump past it. Topbar height is now the literal `56px` the design
  calls for (was `lg:h-18`, a Tailwind arbitrary value that doesn't correspond to the intended
  height).
- **`error.vue`** was the one file in the whole app still on a fully independent, off-token
  palette (`zinc-*`) — now on the same tokens as everything else.
- **The play/pause transport button** (`PlayerPlayPauseButton` in `AudioPlayer.vue`) now uses its
  own `highlighted` prop instead of the caller overriding its background/text colour classes
  directly - one fewer place a future colour change has to be kept in sync by hand.
  `AudioPlayer.vue`'s progress-bar fill drops the hard-coded
  `linear-gradient(#d97706,#fbbf24,#f59e0b)` for a plain `bg-amber-400`, matching every other
  progress indicator in the app (`UiLoadingPanel`, `DataTable`'s bulk bar).

### A test caught a resolveComponent bug before it shipped

`SidebarItem.vue`'s first draft resolved its NuxtLink-or-button tag inline in the template:
`:is="to ? resolveComponent('NuxtLink') : 'button'"`. The SFC compiler hoists a
`resolveComponent()` call written directly in a template expression to module scope, outside any
active component instance - at that point there's no Nuxt app context for it to search, so it
silently falls back to rendering a literal, unresolved `<nuxtlink>` tag instead of throwing.
`test/components/layout/SidebarItem.test.ts`'s very first assertion (`wrapper.find('a').exists()`)
failed immediately. The fix - and the pattern to use everywhere else in this codebase
(`ui/Button.vue` already did it correctly) - is to resolve the tag in a `computed()` in
`<script setup>`, which runs during the actual render pass where the instance context is live,
and reference that computed's result (`:is="tag"`) from the template instead of calling
`resolveComponent()` inline in a template expression.

### happy-dom gaps this stage's tests worked around

Two more, beyond the `offsetParent`/`mouseenter`-bubbling ones Stage 0/1 already hit:

- **Native `<label>` click-to-child-input forwarding isn't simulated.** In a real browser,
  clicking a `<label>` also toggles/focuses the `<input>` it wraps (implicit label association).
  happy-dom doesn't replicate this, so `DataTable`/`Checkbox` tests that need to "check a box"
  dispatch `change` on the `<input>` itself (after setting `.checked`) rather than clicking the
  wrapping label.
- Both are documented inline at the point of use rather than in a shared test helper, since each
  is a one-line workaround specific to the element being interacted with.

## Dashboard + Browse (Stage 4)

The reference handoff has no dashboard/home screen (its 12 screens start at Browse), so
`pages/index.vue` and `components/dashboard/*` got a straight retokenise with one structural fix,
not a redesign:

- **`dashboard/Section.vue` had a layout-shift bug**: its loading state used the shared
  `LoadingGrid.vue` component, whose grid (`grid-cols-2 … xl:grid-cols-6`, tuned for
  `playlists/index.vue`'s fixed-column grid) didn't match the dashboard's own loaded-state grid
  (an auto-fill `minmax(130px,200px/220px)` definition). The skeleton tiles snapped into a
  different column count the instant real data arrived. Fixed by having `Section.vue` render its
  skeletons inside the *same* grid container as its real content (now `ui.grid.auto`), rather
  than delegating to a component with its own competing grid. `LoadingGrid.vue` itself is
  untouched - `playlists/index.vue` still uses it correctly in Stage 7.
- The dashboard's seeded greeting (`useState('dashboard-seed', () => Math.random())`) was flagged
  as a hydration-mismatch risk worth checking - it isn't one: `useState` is Nuxt's SSR-serialized
  state primitive specifically so the client reuses the server's random value instead of
  recomputing its own. A plain `ref(Math.random())` would have been the actual bug.

**Browse** (`pages/browse.vue`, `components/browse/*`) has a reference (`01-browse*.png`) and
picks up real behavioural fixes alongside the retokenise:

- **`FilterSort.vue`** was a raw native `<select>`, visually inconsistent with its sibling filter
  chips. Rewritten on the shared `Dropdown.vue`, which gained two small, generally-useful
  additions to support it: an optional leading `icon` prop, and `allowClear` (default `true`) to
  hide the "All" entry for a control like sort order that always has exactly one active value
  rather than an optional filter.
- **`FilterGenre.vue` and `FilterScore.vue` gained a real bug fix, not just a backdrop.** Their
  clear ("×") control was an SVG with a click handler living *inside* the trigger `<button>` -
  invalid HTML (a button can't contain another interactive control) and unreachable by keyboard
  entirely. Split into two sibling buttons sharing one visual pill (trigger + a separate clear
  button), each independently focusable. Both also gained the click-outside backdrop and Escape
  handling every other dropdown in the app already has, via the same non-immediate-watch pattern.
- **`components/RadioGroup.vue` and `artist/ListToggle.vue` share one wrapper now**
  (`ui.segmentGroup`, new) - both are the same bordered-pill-of-toggle-buttons shape, previously
  hand-written twice. `ListToggle.vue` (the catalogue grid/list switch) also gained the
  `role="radiogroup"`/`role="radio"` + roving-tabindex contract `RadioGroup.vue` already had, plus
  a real accessible name (`title`/`aria-label`) on each icon-only option - it had neither before.
- `ArtistGrid.vue`/`ListSummarized.vue` now render their "no results" state through
  `UiEmptyState` instead of a bare line of text.

## Artist page (Stage 5)

The biggest screen, matched against `02-artist.png`. Retokenised throughout
(`components/artist/*`, `components/release/{TracksTable,StatusBadge}.vue`,
`pages/artist/[slug].vue`), plus:

- **Deleted, confirmed zero real consumers**: `artist/{Cover,Links,TotalPlays,TotalTracks,
  Initial}.vue`, `release/Cover.vue`. `artist/DialogLinks.vue` is also deleted - it was only ever
  reachable through `ArtistHeader.vue`'s `showAllLinks` ref, which nothing ever set to `true`
  (the trigger for it lived in `artist/Links.vue`, itself dead). `ArtistHeader.vue` also drops an
  `imgUrl` computed that resolved an artist photo never rendered anywhere in its template - the
  reference header has no artist avatar either, so this wasn't a gap to fill, just dead code to
  remove.
- **A second instance of the Stage 1 SSR bug, this time in `ArtistReleases.vue`.** Its deep-link
  handler (`?releaseId=…` expands and scrolls to a release) ran off an
  `watch(() => props.releases, ..., { immediate: true })`. The common case (no query param)
  returns before touching the DOM, so this shipped for a long time without incident - but a real
  deep-linked page load reaches `await nextTick()` then `document.querySelector(...).
  scrollIntoView(...)`, and an immediate watcher's callback runs synchronously at the `watch()`
  call site, i.e. during server-side `setup()`, where `document` doesn't exist. Fixed with the
  same `onMounted` (first run) + non-immediate `watch` (later changes) split used in Stage 1/3.
  Prompted a repo-wide grep for every other `{ immediate: true }` watcher - the rest either don't
  touch `document`/`window` at all, or already guard the access with optional chaining against an
  empty/unmounted ref (`downloads/ApprovalQueue.vue`'s highlight-scroll does this correctly).
  Two of the untouched instances (`issues/TypeContent.vue`, `downloads/HistoryContent.vue`) are
  logic-only and outside this stage's files, checked but not modified.
- **`browse/FilterSort.vue`'s sibling in this screen** - the release sort control in
  `ReleaseFilterBar.vue` - is now also a `Dropdown` with `allow-clear="false"`, replacing its own
  hand-rolled trigger+listbox (which had neither Escape nor a click-outside backdrop). Its trigger
  now shows the active sort's label instead of a static "Sort", matching Browse's pattern.
- **`RadioGroup.vue`/`artist/ListToggle.vue`'s shared wrapper is `ui.segmentGroup`** (introduced
  in Stage 4) - `ListToggle` (the catalogue grid/list switch) picks up the same
  `role="radiogroup"`/roving-tabindex contract, plus `title`/`aria-label` on each icon-only
  option, which it previously had neither of.
- Status/severity colour in `ReleaseGroupDetails.vue` (the downloading pill, the awaiting-merge
  pill) now reads `helpers/ui.ts`'s `toneBg.info`/`toneBg.warning` instead of hand-written
  `bg-blue-500/10 text-blue-400` / `bg-amber-500/10 text-amber-400` literals - one fewer place
  duplicating the download-status palette Stage 12 has to reconcile.
- `pages/artist/[slug].vue` drops `layoutClasses: 'p-0'` from its page meta - confirmed the only
  occurrence of that key anywhere in the codebase; nothing reads it.

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
