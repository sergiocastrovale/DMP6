# Handoff: DMP Home Redesign

A modernized home screen for **DMP** (Daniel's Music Player) — a local-music catalogue app. This bundle is a **design reference**, not production code. Your task is to recreate the design in the existing **Vue 3 + Tailwind CSS** codebase, using DMP's established patterns, state stores, and routing.

> The reference HTML is built with React + inline Babel for fast prototyping. **Do not port the JS architecture or the raw CSS** — translate the design into idiomatic Vue 3 (`<script setup>`, composables, existing stores) and Tailwind utility classes / design tokens.

---

## How to use this with Claude Code

1. Drop this folder into the DMP repo (e.g. `apps/dmp/design_handoff_home/`).
2. In Claude Code:
   > "Read `design_handoff_home/README.md` and `design_handoff_home/styles.css`. Recreate this design in the existing Vue 3 + Tailwind codebase. Update `tailwind.config.js` with the design tokens from the README's *Tailwind config* section, then refactor `src/views/Home.vue`, `src/components/Sidebar.vue`, and the top bar to match. Use the project's existing icon components and Pinia stores — don't copy the placeholder data from `data.js` or the placeholder cover generator from `covers.jsx`."
3. Work component-by-component (tailwind config → sidebar → top bar → section → card) so each diff is reviewable.
4. Open `index.html` in a browser to compare side-by-side with the running Vue app.

---

## Screenshots

| File | Shows |
|---|---|
| `screenshots/01-home-default.png` | Default home view — magazine title, hero stats, 4-col grid (clamps from 5 at ≤1180px), spacious density |
| `screenshots/02-sidebar-collapsed.png` | Sidebar collapsed to icon column (72px), chevron rotated |
| `screenshots/03-search-active.png` | Search filters all sections into a single "Search results" view |
| `screenshots/04-recently-played.png` | Second section (one-off — same treatment, no meta subtitle) |

---

## Fidelity

**High-fidelity.** Exact colors, type scales, spacing, hover/focus behavior, and responsive breakpoints are specified. Recreate pixel-for-pixel; don't reinterpret.

---

## Constraints (from the product owner)

- **Do not change the existing icon set.** Use DMP's current icons. The icons in the reference are placeholders matching the existing visual weight (1.75 stroke, 20px, rounded line caps).
- **Dominant colors stay**: yellow, white, black. No new brand colors.
- **Editorial sensibility, not Spotify clone.** Numbered sections, mono metadata, hairline rules, generous whitespace.

---

## The committed design — one configuration

The reference originally exposed multiple variants behind a Tweaks panel. **Only one configuration ships:**

| Knob | Value |
|---|---|
| Editorial mode | **Magazine** (large display titles, no section numbers shown) |
| Stats variant | **Hero readout** (large display numbers in top bar) |
| Density | **Spacious** (generous padding) |
| Card style | **Covers + meta** (cover image + title + artist + year · genre below) |
| Grid | **5 columns** at desktop (clamps to 4/3/2 responsive) |
| Type pairing | **Geometric — DM Sans** (UI + display), JetBrains Mono (metadata) |
| Yellow intensity | **1.4** (max) |
| Now-playing footer | **Removed** — design does not include a player bar |
| Section meta subtitle | **Removed** — sections show only number + title |

---

## Tailwind config

Add to `tailwind.config.js` (Tailwind v3 syntax):

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (warm-tinted dark)
        bg:    { DEFAULT: '#0c0b09', 1: '#131210', 2: '#1a1815', 3: '#221f1b' },
        ink:   { DEFAULT: '#f5f1e8', 2: '#b8b1a2', 3: '#807a6e', 4: '#4d4942' },
        rule:  'rgba(255, 250, 235, 0.08)',
        // Yellow accent — oklch(0.82 0.25 92), boosted intensity 1.4
        accent: {
          DEFAULT: 'oklch(0.82 0.25 92)',
          soft:    'oklch(0.82 0.25 92 / 0.18)',
          ink:     '#1a1408', // text/icon color on yellow surfaces
        },
      },
      fontFamily: {
        // Geometric pairing (committed)
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Editorial type scale (line-height baked in, tracking via custom plugin/utility)
        'hero-stat':   ['28px',  { lineHeight: '1',    fontWeight: '600', letterSpacing: '-0.02em' }],
        'mag-title':   ['56px',  { lineHeight: '1',    fontWeight: '400', letterSpacing: '-0.035em' }],
        'card-title':  ['14px',  { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.005em' }],
        'card-artist': ['13px',  { lineHeight: '1.3',  fontWeight: '400' }],
        'meta':        ['10px',  { lineHeight: '1.4',  fontWeight: '400', letterSpacing: '0.04em' }],
        'meta-lg':     ['11px',  { lineHeight: '1.4',  fontWeight: '400', letterSpacing: '0.06em' }],
        'meta-num':    ['12px',  { lineHeight: '1.4',  fontWeight: '400', letterSpacing: '0.1em' }],
        'meta-stat':   ['10px',  { lineHeight: '1.4',  fontWeight: '400', letterSpacing: '0.15em' }],
        'meta-side':   ['10px',  { lineHeight: '1.4',  fontWeight: '400', letterSpacing: '0.18em' }],
      },
      borderRadius: {
        // 4px for nav/buttons, 8px for search, 2px for covers (subtle — editorial)
        cover: '2px',
      },
      boxShadow: {
        // Play button float
        play: '0 8px 24px rgba(0,0,0,0.4)',
        // Search focus ring
        'ring-accent': '0 0 0 3px oklch(0.82 0.25 92 / 0.18)',
      },
      spacing: {
        // Sidebar widths
        'sidebar': '240px',
        'sidebar-collapsed': '72px',
      },
    },
  },
  plugins: [
    // Add Google Fonts in <head>:
    // <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  ],
};
```

Then in `index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

And in your global CSS layer (`src/assets/main.css` or equiv):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body { @apply bg-bg text-ink antialiased; font-feature-settings: "ss01", "cv11"; }
  body { overflow: hidden; }
}

@layer utilities {
  .tnum { font-feature-settings: "tnum"; }
}
```

---

## Layout

Two-column page, single screen:

```
┌─────────┬──────────────────────────────────────┐
│         │ TopBar (sticky, may wrap to 2 rows)   │
│ Sidebar ├──────────────────────────────────────┤
│ (240px) │ Main scroll area                      │
│         │   - 01 Latest Additions               │
│         │   - 02 Recently Played                │
│         │   - 03 From the Archive               │
│         │                                       │
└─────────┴──────────────────────────────────────┘
```

```vue
<!-- App.vue -->
<template>
  <div :class="[
    'grid h-screen bg-bg',
    sidebarCollapsed ? 'grid-cols-[72px_1fr]' : 'grid-cols-[240px_1fr]'
  ]">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="sidebarCollapsed = !sidebarCollapsed" />
    <main class="flex flex-col overflow-hidden min-w-0">
      <TopBar v-model:query="query" />
      <div class="overflow-y-auto px-11 pt-9 pb-20 flex flex-col gap-20">
        <LibrarySection v-for="(section, i) in sections" :key="section.id"
                        :number="String(i + 1).padStart(2, '0')"
                        :title="section.title"
                        :albums="section.albums" />
      </div>
    </main>
  </div>
</template>
```

> ⚠️ The `min-w-0` on `<main>` is **required** — without it, the top bar's flex children expand the grid track past the viewport.

---

## Sidebar

**Width**: 240px expanded, 72px collapsed.

### Header
- Yellow logo square (`w-9 h-9 bg-accent text-accent-ink rounded grid place-items-center font-display font-bold text-xl`) showing "D"
- Brand "DMP" — `font-display font-bold text-lg tracking-wide`
- Chevron toggle button (`w-8 h-8 rounded text-ink-3 hover:bg-bg-2 hover:text-ink hover:border hover:border-rule transition`) — chevron `<` when expanded, rotated 180° when collapsed (`transition-transform duration-200`)

In collapsed mode, the header switches to `flex-col` so the chevron stacks below the logo (it must always be reachable).

### Nav items
14px font, 500 weight, gap 12px between icon and label. Padding `py-2 px-3`, 6px radius.

| State | Style |
|---|---|
| default | `text-ink-2` |
| hover   | `bg-bg-2 text-ink` |
| active  | `bg-accent-soft text-accent` + 2px yellow bar 14px to the left of the item (`before:absolute before:left-[-14px] before:top-2 before:bottom-2 before:w-0.5 before:bg-accent`) |

Items (preserve existing DMP icons, these are illustrative):
- Home
- Browse — count `3,892`
- Explore
- Timeline
- Playlists — count `47`
- Favorites — count `214`
- Issues — count `3`
- Labs

Count style: `font-mono text-[11px] text-ink-4`. On active item: `text-accent opacity-80`.

A `LIBRARY` section label sits above the nav (`font-mono text-[10px] tracking-[0.18em] uppercase text-ink-4 px-3 pt-4 pb-2`).

### Footer (above the bottom of the sidebar)
Divider (`border-t border-rule pt-3 mt-3`) then:
- Statistics
- Settings
- Sign out

Same item style as nav.

### Collapsed mode
- Hide: brand text, section label, item labels, item counts
- Nav items: `justify-center px-0`
- Active item's left bar moves from `left-[-14px]` to `left-0`

---

## Top bar

Sticky, padding `py-3.5 px-11`, `border-b border-rule`. Flex row, `flex-wrap`, gap-6, row-gap-3.5.

When the viewport gets narrow, the search wraps to its own row beneath the stats — this is intentional, not a bug.

### Hero stats (committed variant)
Four inline stats, separated by 1px vertical hairlines (`w-px self-stretch bg-rule my-1`):

| # | Number | Unit | Label below |
|---|---|---|---|
| 1 | `1,247`         | —      | `ARTISTS` |
| 2 | `3,892`         | —      | `RELEASES` |
| 3 | `47,318`        | —      | `TRACKS` |
| 4 | `3,842` `h` `34` `m` | inline | `TOTAL PLAYTIME` |

For each stat:
```vue
<div class="flex flex-col gap-0 leading-none">
  <div class="font-display font-semibold text-[28px] tracking-[-0.02em] text-ink tnum">
    {{ value }}<!-- units in spans: -->
    <span class="text-[14px] text-ink-3 font-medium ml-0.5">h</span>
  </div>
  <div class="font-mono text-[10px] tracking-[0.15em] uppercase text-ink-4 mt-1.5">
    {{ label }}
  </div>
</div>
```

**All four stat numbers are `text-ink` (white)** — playtime is *not* yellow. The yellow lives in the logo, active nav, search focus ring, and play button.

Responsive sizing for the stat number:
- `≥1320px` → 28px
- `980-1320px` → 24px → 22px → 20px (steps at 1320 / 1180 / 980)

The dividers hide at ≤980px (stats just shrink and sit closer together).

### Search
- `flex-1 min-w-[200px] max-w-[520px] ml-auto relative`
- Input: `w-full bg-bg-2 border border-rule rounded-lg py-2.5 px-3.5 pl-10 text-ink text-sm placeholder:text-ink-4 outline-none transition`
- Focus: `focus:bg-bg-1 focus:border-accent focus:shadow-ring-accent`
- Search icon: absolute `left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none`
- Kbd hint "⌘ K" (only shown when empty): absolute right-2.5, `font-mono text-[10px] text-ink-4 border border-rule px-1.5 py-0.5 rounded`

**Behavior**: typing replaces the three-section view with a single "Search results" section, filtered case-insensitively on title / artist / genre.

---

## Section

Section header (`flex items-end justify-between gap-4 flex-wrap pb-6 mb-8 border-b-2 border-rule`):
- **Left** (`flex items-baseline gap-[18px] flex-wrap`):
  - Section title `font-display text-[56px] font-normal tracking-[-0.035em] leading-none` (e.g. "Latest Additions"). Responsive: 40px at ≤980px, 22px at ≤640px.
  - No section number ("01") visible — magazine mode hides it
  - No meta subtitle (e.g. "Added this week" removed)
- **Right** (`flex items-center gap-1.5 whitespace-nowrap`): two view-mode toggle buttons only.
  - Grid icon → covers + meta view (committed default)
  - List icon → list view (optional fallback)
  - Toolbtn: `w-[30px] h-[30px] rounded grid place-items-center text-ink-3 hover:bg-bg-2 hover:text-ink transition`. Active: `bg-accent text-accent-ink`.

Three sections render on Home in this order:
1. **01 — Latest Additions** — newest 10 albums (by `dateAdded`)
2. **02 — Recently Played** — last 6 album ids
3. **03 — From the Archive** — 8 albums unplayed in 2+ years

---

## Card (committed style: covers + meta)

Grid: `grid grid-cols-5 gap-8` at desktop, clamped:
- `≤1180px` → 4 cols
- `≤920px` → 3 cols
- `≤640px` → 2 cols

> Magazine row-gap is bumped: use `gap-x-8 gap-y-10` for vertical breathing room.

Each card:
```vue
<article class="cursor-pointer flex flex-col gap-3 group">
  <!-- cover -->
  <div class="aspect-square relative overflow-hidden rounded-cover bg-bg-2">
    <img :src="album.cover" :alt="album.title"
         class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]" />
    <!-- play button (yellow circle, hover reveal) -->
    <button class="absolute right-3 bottom-3 w-11 h-11 rounded-full bg-accent text-accent-ink
                   grid place-items-center shadow-play opacity-0 translate-y-2
                   transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
      <PlayIcon class="w-4 h-4" />
    </button>
  </div>
  <!-- meta -->
  <div class="flex flex-col gap-0.5 min-w-0">
    <div class="font-semibold text-card-title text-ink truncate">{{ album.title }}</div>
    <div class="text-card-artist text-ink-2 truncate">{{ album.artist }}</div>
    <div class="flex items-center gap-2 mt-0.5 font-mono text-meta uppercase text-ink-4 min-w-0">
      <span class="shrink-0">{{ album.year }}</span>
      <span class="w-0.5 h-0.5 rounded-full bg-ink-4 shrink-0"></span>
      <span class="truncate min-w-0">{{ album.genre }}</span>
    </div>
  </div>
</article>
```

Key points:
- Card cover radius is **2px** (subtle, almost square — that's the editorial signature; do not use the default Tailwind `rounded` 4px)
- Card title uses display font in magazine mode (`font-display text-base font-semibold` — bigger than 14px default, 16px works well)
- The genre is the only flex-child allowed to truncate; year and dot stay rigid
- **No runtime in the card meta** — that lives on the release detail page
- Example long-genre name to test wrapping: `Norwegian Black Metal` (one album in the placeholder data is set this way)

### Hover behavior
1. Cover image scales `1.04` (400ms ease)
2. Play button fades in and rises 8px (200ms ease)
3. Cursor: pointer

### Optional list variant
The Tweaks panel allowed a "list" card style. If you keep it as an optional view-mode (clicked via the list toolbar button), the row uses:
- `flex items-center gap-4 px-3 py-2.5 border-b border-rule hover:bg-bg-1`
- 52×52 thumbnail, no play button overlay
- Right-aligned detail row (`flex gap-6 items-center font-mono text-[11px] text-ink-3 tracking-[0.04em]`): year, genre, "X tracks", runtime (`MM:SS`, in `text-ink-2`)

---

## Interactions

| Interaction | Behavior | Timing |
|---|---|---|
| Card hover | Cover scales 1.04; play button fades in & rises 8px | 200–400ms ease |
| Nav item hover | Color → `text-ink`, bg → `bg-bg-2` | 150ms |
| Toolbar btn hover | Color → `text-ink`, bg → `bg-bg-2` | 150ms |
| Search focus | Bg lightens, border yellow, soft yellow ring (`shadow-ring-accent`) | 150ms |
| Sidebar toggle | Width 240↔72px; chevron rotates 180° | 200ms (transform only — grid width snaps) |
| Search type | Live-filter all sections into single "Search results" view | instant |
| View toggle click | Section grid swaps between meta / list immediately | instant |

---

## Responsive breakpoints

| Max width | Change |
|---|---|
| 1320px | Stat number 24px; stats gap shrinks |
| 1180px | Stat number 22px; search max 300px; grid clamps to 4 cols |
| 980px  | Stat number 20px; stats dividers hidden; section title 40px; grid clamps to 3 cols |
| 720px  | Sidebar auto-collapses to 64px; stats hidden, header simplified |
| 640px  | Top bar stacks vertically; grid clamps to 2 cols; section title 22px |

---

## State (Vue 3 / Pinia)

Replace placeholder data with calls to existing stores:

**Library store**
- `albums` — array of `{ id, title, artist, year, tracks, runtime, genre, coverUrl, dateAdded, lastPlayed }`
- `latestAdditions` — newest 10
- `recentlyPlayed` — last 6 played
- `archive` — `lastPlayed` > 2 years ago

**Stats store** (top bar)
- `artists` — distinct artist count
- `releases` — total album count
- `tracks` — total track count
- `totalRuntime` — `{ hours, minutes }`

**UI store**
- `sidebarCollapsed: boolean`
- `searchQuery: string` — drives the global filter

---

## Assets

The reference uses **generative SVG placeholders** for album covers. In production, use actual cover art from DMP's library. Cover image element: `aspect-square w-full object-cover rounded-cover` with subtle 1.04 scale on group hover.

For artists/releases without artwork, fall back to a neutral `bg-bg-2` tile with the title initials in display font.

---

## Files in this bundle

| File | Purpose |
|---|---|
| `index.html`        | Open in a browser to view the live reference |
| `styles.css`        | Source of truth for visual styling — translate to Tailwind utilities + the config above |
| `data.js`           | Sample album/stats data (placeholders, not real DMP data) |
| `sidebar.jsx`       | Sidebar React component — port structure to `<Sidebar.vue>` |
| `topbar.jsx`        | Top bar + hero stats — port to `<TopBar.vue>` |
| `library.jsx`       | Section + Card + grid logic — port to `<LibrarySection.vue>` + `<AlbumCard.vue>` |
| `icons.jsx`         | Illustrative icons — **do not port; use DMP's existing icons** |
| `covers.jsx`        | Placeholder cover generator — **do not port; use real artwork** |
| `app.jsx`           | Root composition — port logic only, not React structure |
| `tweaks-panel.jsx`  | Dev-time tweak panel — **do not port** |
| `screenshots/*`     | Reference screenshots of the committed design |
