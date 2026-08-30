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

## Explore (Stage 6)

Matched against `03-explore*.png`. This screen went from four static sliders to a real
now-playing experience: `components/explore/{Shell,Config,Card,History}.vue`, plus two new
shared pieces.

- **`components/player/SeekBar.vue` (new)** - the progress bar extracted out of
  `player/AudioPlayer.vue` so Explore's now-playing card can use the identical control. Props
  `currentTime`/`duration`/an optional `countDown` (Explore shows time-remaining, the mini-player
  shows elapsed); emits `seek`. Carries the full contract from Stage 1's primitives:
  `role="slider"` + aria value attributes, ArrowLeft/ArrowRight seek ±5s, click-to-seek via
  `getBoundingClientRect`. `AudioPlayer.vue` now composes it instead of hand-rolling its own bar;
  its old `progressPct`/`formatDuration`-for-the-bar plumbing is gone.
- **Cinema mode is shared `useState`, not an `AppShell` prop.** The plan called for a `chrome`
  prop on `AppShell`, but Nuxt layouts don't receive props from the page - `AppShell` sits in
  `layouts/default.vue`, outside the page's own props. `composables/useChrome.ts` exposes a
  `useState('chrome-visible', () => true)` boolean plus `hide()`/`show()`; `AppShell.vue` wraps
  the sidebar/topbar/mobile-nav/player bar in `v-if="chromeVisible"` and renders a bare
  `<main>` when hidden. `explore/Shell.vue` calls `hide()`/`show()` from a fullscreen toggle
  button, captures/restores focus across the transition (same pattern as `Dialog.vue`), and exits
  on Escape via the onMounted/non-immediate-watch SSR-safe split - `document.addEventListener`
  only ever runs from a watch callback reacting to a client-side state change, never on the
  initial (server) render.
- **`explore/Config.vue` gains a `collapsed` mode.** Once a track is picked, the four sliders
  fold into a one-line summary (`Exploring {mood} tracks of the {era} · {discovery} discovery ·
  {sound} sound`) with a "Change" button that re-expands them - matching the reference, where the
  sliders aren't meant to stay onscreen competing with the now-playing card.
- **`explore/Card.vue`** rebuilt as the now-playing card: cover art, title/artist (link when
  `artistSlug` is present, plain text otherwise)/album, the new `SeekBar` in countdown mode, a
  transport row (previous/play-pause/next wired straight to the player store, `ToggleFavorite`
  with its new `alwaysVisible` prop so the heart doesn't hide below `lg` here), and "Another
  pick" wired to a re-roll.
- **`explore/History.vue`** ("Previously Played") gained a per-row cover thumbnail and a play
  overlay icon; the artist link is now a separate sibling `<NuxtLink aria-label="Go to {artist}">`
  next to the play button rather than nested inside it (nested interactive elements are invalid
  HTML and unreachable by some assistive tech).
- **`ToggleFavorite.vue`** gained `alwaysVisible?: boolean` (default `false`) - existing call
  sites keep the hover-to-reveal `hidden lg:block` behaviour; Explore's card passes `true` since
  there's no hover surface to reveal it on a single focused card.

**Bugs found while testing, not present in the shipped app before this stage** (both introduced
by this stage's own rewrite, caught before commit):
- `AudioPlayer.vue`'s new `@seek="player.seek"` passed the store method by reference. Pinia's
  `vi.spyOn(player, 'seek')` replaces the property on the store object, but `SeekBar` had already
  captured the pre-spy reference at its last render with no re-render in between, so the spy saw
  zero calls. Fixed to `@seek="(time) => player.seek(time)"`, matching the original inline
  handler's call-time-lookup behaviour. Anywhere a store action is passed as an event handler,
  wrap it in an arrow function for this reason, not just style.
- `Shell.test.ts`'s "config collapses" assertion first checked `wrapper.find('[role="slider"]").
  exists()).toBe(false)` to prove the sliders were gone - false negative, because once
  `explorerCurrentTrack` is set `ExploreCard` renders too, and its `SeekBar` is *also*
  `role="slider"`. Not a component bug; fixed the test to check for `Config`-specific text
  instead.

## Timeline, Playlists, Favorites (Stage 7)

Matched against `04-timeline.png`, `05-playlists*.png`, `06-favorites_*.png`.

- **New shared `components/TrackTable.vue`** replaces two near-duplicate div-based tables,
  `playlist/TrackTable.vue` and `favorites/TrackTable.vue` (both deleted). `PlaylistTrack` and
  `FavoriteTrack` already share the same `{ id, track: TrackInContext }` shape, so one component
  now takes `rows: Array<{ id, track }>` and renders play/pause, cover, title+artist+album and
  duration on `SlimTable`/`SlimTableRow` - the same real-`<table>` lineage `TrackList.vue`
  standardised on in Stage 2. Clicking a row queues every row in table order and starts at the
  one clicked (`playerStore.setQueue`); the differing bit each screen needs - a remove `×` for a
  manual playlist, a filled heart for favorites - is a `#action="{ row }"` scoped slot rather
  than a prop, since the two actions differ in icon, colour and the condition that shows them.
  This is also the last non-`downloads/*` consumer of `Table.vue`/`TableRow.vue` migrated off
  them (per the Stage 2 note) - only `downloads/ApprovalQueue.vue` is left, moving in Stage 12.
- **The playlist tile's conic-gradient border now uses the shared `genre-border` utility** from
  `main.css` (Stage 0) instead of its own `<style scoped>` block - `playlist/Block.vue` was one
  of the two deferred consumers named when that utility was created, the other being
  `pages/playlists/[slug].vue`'s hero cover, fixed the same way here. Both had drifted slightly
  from each other (different border widths, radii, and one read the never-defined
  `var(--color-surface)`); one definition now, so a themed change to the ring applies everywhere.
- **`pages/playlists/[slug].vue`'s hand-rolled `Teleport` delete modal is gone**, replaced with
  `ConfirmDialog` (focus trap, Escape, `role="dialog"` all inherited for free). Its confirm
  handler now follows the same fire-and-forget convention already used by
  `artist/DeleteDialog.vue`: close the dialog immediately on confirm rather than waiting on the
  request, and surface a toast on failure instead of only a `console.error` - there was no user-
  visible failure feedback before.
- **Timeline's year rail is now responsive.** The reference is a fixed-position magazine layout
  (absolute year label + vertical line + dot, permanently indented `pl-40`) that was unusable
  under `lg`: the label sat at a negative offset from the content column, so on a narrow viewport
  it rendered off-screen instead of just cramped. The desktop rail (`lg:` absolute positioning)
  is unchanged in spirit; below `lg` each year now gets an ordinary heading stacked above its own
  grid instead of being positioned relative to a column that no longer exists at that width.
  Decade/year pills moved off hand-written `bg-accent`/`bg-bg-2` conditionals onto `sw('chip',
  active)` - the same toggle-chip recipe Browse's filters already use.
- Both `playlist/List.vue` (the Your/Genre/Region sections) and the timeline/favorites empty
  states now go through `UiEmptyState` instead of each writing its own icon+sentence block.

## Login and change-password (Stage 8)

Matched against `12-login.png`.

- **New `components/ui/TextField.vue`** replaces the identical hand-written `<label>` +
  `<input>` markup that was copy-pasted across both pages: a `useId()`-generated id links the
  label and input, and an optional `error` prop renders a `role="alert"` paragraph wired to the
  input via `aria-describedby` + `aria-invalid` - there was no programmatic association before,
  just a plain paragraph placed near the field.
- **Login's single "Invalid credentials" error is attached to the password field** (`useAuth`
  doesn't say which of username/password was wrong, and attaching it to the field the user needs
  to re-type first is the common convention). Change-password splits its one `error` ref into a
  `fieldErrors { current, new, confirm }` object, since the three failure cases it already
  branched on - too short, mismatch, wrong current password - map cleanly onto three different
  fields, giving one screen-reader announcement instead of forcing a re-read of the whole form.
- **Labels are now real, visible `<label>` elements, not placeholder-only fields** - the
  reference screen shows exactly this (visible "Username"/"Password" labels above each input).
  This broke two e2e specs' `page.getByPlaceholder('Username'/'Password')` login helper
  (`artist-delete.spec.ts`, `scan-actions.spec.ts`); switched both to `page.getByLabel(...)`,
  which is the more correct target now that the field has one.
- `layouts/auth.vue` gets the reference's radial amber glow behind the card
  (`bg-[radial-gradient(...,var(--color-amber-700)...)]`) - an arbitrary-value gradient built
  from a token `var()` rather than a raw hex, which is exactly what emitting the theme as
  `@theme static` (Stage 0) is for.
- No "keep me signed in" checkbox: the reference shows one, but `useAuth`'s login has no
  remember-me concept and adding one would mean session-duration server work, not a restyle -
  out of scope for this stage.

## Statistics (Stage 9)

Matched against `07-statistics*.png`.

- **`components/statistics/StatPage.vue` now composes `DataTable`** (Stage 2's shared table,
  previously built but with zero real consumers) instead of hand-rolling its own `<table>` +
  sort-header + skeleton/empty states a second time. Each of the 16 subpages now passes
  `DataTableColumn[]` and, only where a cell needs more than the raw field value (a link, a
  formatted duration/size/count, a status badge), a `#cell-{key}` scoped slot - StatPage forwards
  every `cell-*` slot it receives straight through to `DataTable` by reading its own `$slots` via
  `defineSlots()`, so it never needs to know the columns' shapes ahead of time.
- **`DataTable` gained two small, generic additions** driven by this being its first real
  consumer: an optional `class` per `DataTableColumn` (applied to both the header cell and every
  row's cell, e.g. `hidden md:table-cell` - hiding only the cell's content would leave an empty
  `<td>` still occupying a column) and `tabular-nums` on the default (non-slotted) cell renderer
  when the column is right-aligned, so plain numeric columns don't jitter without every column
  needing its own slot just for that.
- **A pre-existing key/field mismatch surfaces once but is deliberately preserved**: `tracks`,
  `plays` and `bitrate` sort by `artist` (the API's `sortMap` key, matching the raw track column)
  but the row's actual field is `artistName`. Under the old hand-rolled `#row` slot this was
  invisible - the slot always wrote `item.artistName` by hand, decoupled from the column's `key`.
  DataTable's default cell render looks fields up **by column key**, so these three columns each
  need a `#cell-artist` slot reading `row.artistName` explicitly; the `key: 'artist'` itself stays
  as-is since changing it would send the wrong `sort=` value to the API.
- **New `components/statistics/LinkedTitle.vue`** replaces the `NuxtLink`-or-`span` pair that was
  copy-pasted into 7 of the 16 subpages' title columns (releases, shortest, incomplete,
  missing-art, unmatched, releases-synced, releases-with-art) - one component instead of seven
  near-identical slot bodies.
- **`incomplete.vue`'s status column now renders `ReleaseStatusBadge`** instead of its own
  `STATUS_LABELS` map, which only covered `INCOMPLETE`/`MISSING_TRACKS` and would have silently
  fallen through to the raw enum value for any other status - the one true status→label→tone
  source (`helpers/constants.ts`, Stage 2) already covers every `ReleaseStatus`.
- **`pages/statistics/index.vue` gets the reference's hero playtime banner and four stat tiles**
  (Artists/Releases/Tracks/Total plays, each linking to its subpage) - genuinely new UI, not a
  restyle, since neither existed before. The remaining sections (Library, MusicBrainz Sync, Cover
  Art, Curation) keep the label/value row layout but lose the two items promoted to tiles/hero
  (Artists, Releases, Tracks, Total plays, Total playtime) and the now-empty Playback section is
  removed outright. Curation - the one section listing problems, not counts - gets the `warning`
  tone (orange) on its icon, header and the "Browse" link, instead of the neutral/accent styling
  every other section uses; this is the one place colour alone carries meaning, but it's paired
  with the section already being distinctly labelled "Curation" and every row underneath still
  reads as plain text, so nothing depends on the colour to be understood. No checkboxes/bulk
  actions or per-row play/info icons were added even though the reference screenshot shows them -
  these are read-only informational lists with no defined bulk action or per-row detail view for
  most of the 16 row shapes (a genre or artist row has nothing to "play"), and shipping a
  selection UI with nothing wired to it would be exactly the half-finished feature CLAUDE.md
  rules out.

## Settings and scan surfaces (Stage 10)

Matched against `08-settings.png`.

- **New `components/settings/SaveBar.vue`** replaces the Save-button-plus-saved/error-span row
  copy-pasted into seven of the eight settings forms (every one except `UsersForm`, which is a
  CRUD table with no single save action). The feedback text now sits inside a permanent
  `aria-live="polite"` region instead of a span that silently appears/disappears - a screen
  reader only announces content that was already present in a live region when it changes, not a
  node that gets inserted after the fact, so this was the actual bug the plan's "live region, not
  a silently-appearing span" line was about. A default slot carries the one form
  (`ScrobbleForm.vue`) that needs an extra action button (Connect Last.fm) alongside Save.
- **`components/settings/SettingsField.vue`** gets a real `useId()`-linked `<label for>` (it had
  none before - `label`/`description`/`input` were three unconnected elements) and its
  `focus:border-blue-500` replaced with the token focus ring. Its `select` branch now uses
  `helpers/ui.ts`'s `form.select` recipe - unused until this stage, like `DataTable` and its
  `class` column in Stage 9 - which is `appearance-none` on purpose, so it's paired with an
  absolutely-positioned `ChevronDown` the native arrow it removed. `MonitoringForm.vue`'s three
  hand-rolled tri-state selects (monitoring/SongKong/auto-merge on/off/env-default) get the same
  select+chevron treatment and a real `for`/`id` pairing they lacked entirely.
- **`components/settings/PermissionsForm.vue`** and **`UsersForm.vue`** move their raw
  `<table>`s onto `SlimTable`/`SlimTableHeader`/`SlimTableBody`/`SlimTableRow` (Stage 2's
  primitives) instead of a third hand-written table implementation. `PermissionsForm`'s raw
  `accent-blue-500` checkbox is now `UiCheckbox`; `UsersForm`'s role badges move onto
  `toneBg.accent`/`toneBg.info`/`toneBg.muted` and its edit/delete row buttons onto `UiButton`
  (icon-only, with a real accessible name per row instead of a bare icon).
- **`components/ScanActions.vue`** and **`components/RealTimeStatus.vue`** retokenised; the
  latter's inline progress bar, stale-lock banner and history rows move off `bg-bg-*`/`text-ink-*`
  onto the stone/amber scale, and `success`/`danger` tones replace hardcoded `emerald`/`red`.
  `ScanActions.vue`'s dead `hover:border-rule` (identical to its own idle border, so hover never
  visibly changed anything) is fixed to `hover:border-stone-100/10`. Kept the exact button
  count/order `test/components/ScanActions.test.ts` asserts on.
- Every form's card wrapper (`rounded-lg border border-rule bg-bg-1 p-6 space-y-5`) becomes
  `rounded-xl border border-stone-100/6 bg-stone-900 p-6` + `flex flex-col gap-5` - `space-y-*`
  never appears anywhere else in the app post-overhaul, so this drops the only remaining holdout.

## Issues (Stage 11)

Matched against `09-issues*.png`.

- **`IssueTable.vue` stays its own primitive, not `DataTable`** - the Stage 2 decision holds:
  its column keys are dotted paths (`artist.name`, `releaseA.trackCount`) and its per-column cell
  override slots sanitize those into `cell-artist_name` etc., since a dot isn't a valid character
  in Vue's static `#slot-name` shorthand. `DataTable`'s own slot naming (`cell-${key}`) doesn't do
  that sanitization, so it can't take dotted keys without a bigger change to a component several
  other pages will adopt as-is in later stages. Retokenised onto the same `SlimTable`/
  `SortableTh`/`UiCheckbox` primitives `DataTable` itself is built from, so it still reads as the
  same table language everywhere - just with the row-level editable-cell and dotted-slot
  mechanics `DataTable` deliberately doesn't own.
- **New dev-time warning for the exact bug the plan called out**: `IssueTable` now diffs the
  `cell-*` slot names it was actually given against the sanitized names its current `columns` prop
  would produce, and `console.warn`s about any slot that doesn't match one - the case where
  `TypeContent.vue` renames a column `key` but a `#cell-oldKey` slot is left behind, which
  previously failed silently (Vue drops an unused named slot) and the cell would quietly render
  the plain-value fallback instead of the custom one the author still thought was wired up.
- **New `components/ui/BulkBar.vue`** is the shared shell for the fixed, bottom-of-viewport bulk-
  action bar - one definition instead of four near-identical copies
  (`issues/{SelectionBar,RevertSelectionBar,HistorySelectionBar}.vue` here, plus
  `downloads/SelectionBar.vue` which moves onto it in Stage 12). All four had drifted: a stale
  `lg:left-56` (224px) held over from before the sidebar became 240px wide (Stage 3), and each
  reacted to `terminal.isOpen` alone where the shell itself only reserves the drawer's 500px when
  `terminal.isOpen && settings.showTerminal` - so a bar could shrink itself for a terminal that
  wasn't actually visible. Both are real, not cosmetic: the offset was 16px short of the sidebar
  edge, and the second was a visible empty gap whenever `showTerminal` was off.
- **`HistoryContent.vue`'s hand-rolled tab bar is now `Subtabs`** (the shared component
  `TypeContent.vue` already used) instead of a second implementation of the exact same
  underline-tab-with-count-pill pattern; its table moves onto `SlimTable`/`UiCheckbox` like
  `IssueTable`.
- **Deleted `issues/IssueStatusBadge.vue`** - confirmed zero consumers (only auto-generated
  component-type registrations referenced it). `ConfidenceBadge`/`EnrichmentFieldBadge`'s colour
  maps move onto `toneBg` (`high`→success, `medium`→warning, `low`→danger) instead of their own
  `bg-green-900/40`-style literals.
- Fixed two dead `hover:border-rule` states (`pages/issues/index.vue`'s issue-type cards and
  recent-history link - the hover class was textually identical to the idle border, so hovering
  never visibly changed anything) to a real `hover:border-stone-100/10`.

## Downloads (Stage 12)

Matched against `10-downloads*.png`.

- **`ApprovalQueue.vue` moves onto `SlimTable`/`SortableTh`/`UiCheckbox`**, and was the last
  consumer of `Table.vue` (`TableRow.vue` had zero consumers already) - both are deleted now that
  nothing renders them.
- **Fixed the real status→colour contradiction the plan called out**: `ApprovalQueue`'s own status
  text coloured `DOWNLOADING` blue, while `DownloadsDownloadProgress`'s bar for that same row
  (`→ UiLoadingPanel`) rendered amber (`accent`) - two different colours for one status on one
  row. Both now read a single `STATUS_TONE` map local to `ApprovalQueue` (the other consumer,
  `DownloadProgress.vue`, already used the token-based `success`/`danger`/`accent`/`violet`
  variant names and needed no change).
- **Deep-link highlighting (`?highlight=`, `useHighlightId`) now reuses `SlimTableRow`'s own
  `highlight` prop** instead of a hand-rolled `Map<id, HTMLElement>` + manual `scrollIntoView`.
  The manual version had a latent bug surfaced by this stage's own table swap: a `:ref` callback
  on a component (`SlimTableRow`) returns the component's public instance, not its root DOM node,
  so `scrollIntoView` would have silently done nothing once the row stopped being a raw `<tr>`.
  `SlimTableRow` already runs the identical scroll-and-flash behaviour off its own `highlight`
  prop (built for exactly this, see Stage 2), so the fix was deleting the custom logic, not
  patching it - it's paired with a bespoke 4s ring (`useHighlightId`'s own duration) on top of
  `SlimTableRow`'s shorter 1s flash, so the row stays identifiable after the flash fades.
- **`RecentIssuesPanel.vue`'s `<button>`-inside-a-`<button>` is fixed**: the collapse-toggle and
  refresh action are now two sibling buttons in a shared non-interactive wrapper, not one nested
  in the other (invalid HTML, and the nested click handler's `.stop` doesn't change that the
  markup itself is malformed). Also gained a real `aria-expanded` on the toggle and a second
  explicit toggle button next to refresh, since the chevron itself carried no accessible name.
- **New `components/ui/BulkBar.vue` consumer**: `downloads/SelectionBar.vue` is now a thin
  wrapper over it (Stage 11 built the shell for exactly this, the fourth of the four duplicated
  bars it named).
- **`downloads/RejectDialog.vue` is now a thin wrapper over `ConfirmDialog`** instead of its own
  `Dialog` + two hand-written buttons - loses the inline colour emphasis on the release title
  inside the confirm sentence, which brings it in line with every other confirm dialog in the app
  (e.g. `artist/DeleteDialog.vue`), none of which highlight the subject inline either.
- **`MonitoringTab.vue`'s monitor ON/OFF pill now uses the shared `sw('chip', on)` toggle recipe**
  instead of its own idle/on class pair, and its bare hover-only help icon is now a real
  `<button aria-label>` - previously unreachable by keyboard, decorative-only.

## Labs (Stage 13)

Matched against `11-labs*.png`.

- **Deleted `layouts/labs.vue` and `components/labs/Header.vue`.** The reference doesn't use a
  standalone top-nav layout for Labs at all - every detail-page screenshot shows the same
  collapsed sidebar rail the rest of the app uses, with a plain "‹ Back to Labs" link where the
  old layout had a persistent five-item nav strip. All Labs pages (`index`, `decades`, `genome`,
  `mosaic`, `network`) now use the standard `default` layout (`AppShell`), and the four detail
  pages get a new `components/labs/BackLink.vue` instead. `map.vue` keeps `layout: false` - the
  reference's map is genuinely full-bleed (no sidebar at all), which was already the right call
  before this stage; it gets its own slim back-link row above the map canvas instead of floating
  one over the Leaflet canvas, avoiding any collision with Leaflet's own top-left zoom control.
- **New `helpers/theme.ts` (`cssVar`)** reads a design token's live value off the document root
  (`getComputedStyle(document.documentElement)`), SSR-guarded. This is why `theme.css` is emitted
  `@theme static` in the first place (Stage 0) - it's the one thing making every non-Tailwind
  rendering surface here (Chart.js canvases, d3 SVGs, Leaflet's vector layer) able to read the
  current theme instead of a colour literal frozen at the moment someone copied it in.
- **`decades.vue`'s six hardcoded Chart.js `rgba()` pairs** are replaced with `cssVar` reads of
  five ramps (amber/green/orange/red/violet) plus `color-mix()` for the grid lines, angle lines,
  point labels and legend text (previously `rgba(255,255,255,...)` literals). Chart.js also had no
  `onUnmounted` destroy - a real leak, since every rerender created a new `Chart` instance without
  disposing the last one's canvas context and event listeners.
- **`genome.vue` and `network.vue`'s d3 node/link colours** move off hardcoded `oklch()` literals
  onto `cssVar`. Both files carried their own copy of the *old* pre-Stage-0 accent literal
  (`oklch(0.82 0.25 92)`, superseded by amber back in Stage 0) for their "selected/hover" state -
  now `cssVar('--color-orange-400')`, matching the warmer highlight colour the reference actually
  shows against the base amber nodes. Node/link base colours moved off an unrelated blue hue
  (`oklch(0.7-0.75 0.1-0.18 250)`, never one of the app's six ramps) onto amber to match.
- **`map.vue`'s Leaflet `setStyle` calls** move the same way (border colour, hover colour), and
  its own `.leaflet-container`/`.leaflet-control-zoom a` `<style>` block is deleted - `main.css`
  already carries the identical rules from Stage 0, this was the last of the two deferred
  consumers named there (`playlist/Block.vue` was the other, migrated in Stage 7). **The
  `<style>` exception list in `CLAUDE.md` is now empty** - grep confirms zero `<style` blocks
  remain anywhere in `components/` or `pages/`, ahead of Stage 15's teardown checklist.
- **Escape now clears the hover tooltip on the map** - a touch tap fires a synthetic `mouseover`
  with no matching `mouseout` to follow it, so without this a tapped country's tooltip had no way
  to dismiss on a touch device. `genome.vue`/`network.vue`'s tooltips are the same hover-tracked,
  auto-clearing-on-mouseout pattern and have the identical touch gap, but weren't touched here to
  keep this stage's d3 changes to colour-literal fixes only, not new interaction code - worth
  revisiting in the Stage 14 accessibility/resilience sweep.
- **`mosaic.vue`'s hand-rolled delete confirmation is now `ConfirmDialog`**, and its raw
  `<button>` elements move onto `UiButton`/`UiEmptyState`.

## Adding to the system

## Adding to the system

## Adding to the system

## Adding to the system

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
