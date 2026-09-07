# Design system

Concepts and decisions behind the UI overhaul — not a how-to. Implementation lives in the code
(`theme.css`, `themes.css`, `main.css`, `helpers/ui.ts`); this doc is why it's shaped that way.

## Problem it replaced

Before the overhaul: two competing token sets, three separate table implementations, a status
colour hand-written in four different places, component-local `<style>` blocks, and no
accessibility contract — dialogs without focus traps, icon buttons without labels, contrast never
checked. Each screen invented its own version of things every other screen also needed.

## Core idea: one token layer, one recipe layer

Three layers, each depending only on the one below:

1. **Tokens** (`theme.css`) — colour ramps, type scale, radii, shadows as CSS custom properties.
   The single source of truth; no separate generator, no duplicate values anywhere else.
2. **Recipes** (`helpers/ui.ts`) — typed Tailwind utility-string builders for patterns that repeat.
   A pattern earns a recipe on its *second* occurrence, not its first — one-offs stay inline.
3. **Components** — consume recipes, never redefine them locally.

A recipe change or token change propagates everywhere for free. Duplication is the thing being
designed against: one status→colour map, one table family, one bulk-action-bar shape, one confirm
dialog, one dropdown-dismiss behaviour.

**Zero custom CSS.** No component or page carries a `<style>` block. Tailwind utilities cover
everything except a handful of things Tailwind can't express (an animated conic-gradient border,
Leaflet's non-Tailwind DOM) — those become global `@utility` rules, still driven by the tokens, not
one-off escape hatches per component.

## Theming: two independent, orthogonal choices

Accent colour (5 options) and UI text size (6 steps) are both pure token overrides, not component
props threaded through the tree:

- **Accent** redefines the amber ramp's custom properties per `data-theme`, rather than
  refactoring ~170 call sites onto a generic `--color-accent` alias. Overriding the property
  re-colours every consumer with zero component churn.
- **Size** scales the type-scale tokens only (never control heights/padding), so text grows
  without the layout compounding two scales against each other.

Both live in one `localStorage` entry — no DB, no account setting, deliberately a client-only
preference. Applied before first paint via an inline head script, so there's no flash of default
theme on load.

## Accessibility is a bar, not a checklist item

Every primitive meets the same contract: full idle/hover/focus-visible/active/disabled/loading
states, real `role`/`aria-*`, focus trap + Escape + focus restore on anything modal, 4.5:1 text
contrast (3:1 for large text/borders), motion capped and gated behind `prefers-reduced-motion`.
This is enforced mechanically (contrast math against real token pairs, not eyeballed) rather than
trusted to get right by hand each time.

One consequence worth naming: the handoff design's faintest text tiers (30%/40% opacity) fail
WCAG AA on this app's dark surfaces. The repo's own accessibility bar overrides the handoff sheet
— contrast is a hard constraint, not a style preference, so the tiers were compressed until they
passed rather than left as documented but broken.

## Decision principles

- **Where a screen and a primitive disagree, the screen wins.** A recipe is a description of what
  shipped, not a spec imposed on it after the fact — if real usage drifted from the documented
  recipe, the recipe was wrong and gets fixed to match, not the other way round.
- **A recipe only exists once something repeats.** Defining a component or utility ahead of a
  second real consumer produces exactly the drift problem this system exists to prevent — several
  early recipes shipped, got documented, and were never actually adopted, while call sites kept
  hand-rolling the same shape anyway. Recipes are added by finding duplication, not by anticipating it.
- **One migration path can run for years without freezing the app mid-change.** The overhaul used
  a temporary bridge (old and new token sets both live, overlapping the two or three names that
  mattered) so no page had to migrate all at once — never left half-migrated indefinitely, but
  never forced synchronously either.
- **Full-screen has exactly two sanctioned shapes**: collapsing the app chrome around a page that's
  still in the document (cinema mode), or a teleported overlay that calls the real Fullscreen API
  (needed only when the browser API itself is involved, e.g. the visualizer). No third pattern.

## Adding to the system

- New colour/radius/shadow/type size → a token discussion, added to `theme.css`, not a one-off value.
- A utility string that now appears a second time → promote it to a recipe, named for what it is,
  not where it's used.
- Everything else → inline utilities at the call site until it repeats.
