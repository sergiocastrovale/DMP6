# Design system

Concepts/decisions behind the UI overhaul, not a how-to. Implementation: `theme.css`, `themes.css`, `main.css`, `helpers/ui.ts`.

## Problem it replaced

Two competing token sets, three table implementations, status colour hand-written in 4 places, component-local `<style>` blocks, no accessibility contract (dialogs with no focus trap, unlabeled icon buttons, contrast never checked). Each screen reinvented what every other screen also needed.

## Core idea: one token layer, one recipe layer

3 layers, each depending only on the one below:
1. **Tokens** (`theme.css`) — colour ramps, type scale, radii, shadows as CSS custom properties. Single source of truth, no duplicate values elsewhere.
2. **Recipes** (`helpers/ui.ts`) — typed Tailwind utility-string builders for repeating patterns. Earns a recipe on its *second* occurrence, not first — one-offs stay inline.
3. **Components** — consume recipes, never redefine them locally.

A token/recipe change propagates everywhere free. Duplication is what's designed against: one status→colour map, one table family, one bulk-action-bar shape, one confirm dialog, one dropdown-dismiss behaviour.

**Zero custom CSS** — no `<style>` blocks anywhere. Tailwind covers everything except a couple things it can't express (animated conic-gradient border, Leaflet's non-Tailwind DOM) — those become global `@utility` rules, still token-driven, not per-component escape hatches.

## Theming: two independent, orthogonal choices

Accent colour (5 options) + UI text size (6 steps) are pure token overrides, not component props threaded through the tree:
- **Accent** redefines the amber ramp's custom properties per `data-theme` rather than refactoring ~170 call sites onto a generic alias — overriding the property re-colours every consumer, zero component churn.
- **Size** scales type-scale tokens only (never heights/padding) — text grows without two scales compounding against each other.

Both live in one `localStorage` entry — no DB/account setting, deliberately client-only. Applied pre-first-paint via an inline head script (no flash of default theme).

## Accessibility is a bar, not a checklist item

Every primitive: full idle/hover/focus-visible/active/disabled/loading states, real `role`/`aria-*`, focus trap + Escape + focus restore on anything modal, 4.5:1 text contrast (3:1 large text/borders), motion capped and gated behind `prefers-reduced-motion`. Enforced mechanically (contrast math against real token pairs), not eyeballed.

Consequence worth naming: the handoff design's faintest text tiers (30%/40% opacity) fail WCAG AA on this app's dark surfaces — contrast is a hard constraint here, so those tiers were compressed until they passed rather than left documented-but-broken.

## Decision principles

- **Where a screen and a primitive disagree, the screen wins.** A recipe describes what shipped, not a spec imposed after — if usage drifted from the documented recipe, the recipe was wrong and gets fixed.
- **A recipe only exists once something repeats.** Defining ahead of a 2nd real consumer causes the drift this system exists to prevent — several early recipes shipped, got documented, never got adopted while call sites kept hand-rolling anyway. Found by duplication, not anticipated.
- **One migration path can run for years without freezing the app mid-change.** The overhaul used a temporary bridge (old + new token sets both live, overlapping the couple names that mattered) — no page forced to migrate all at once, but never left half-migrated indefinitely either.
- **Full-screen has exactly two sanctioned shapes**: collapsing app chrome around a page still in the document (cinema mode), or a teleported overlay calling the real Fullscreen API (only when the browser API itself is involved, e.g. the visualizer). No third pattern.

## Adding to the system

- New colour/radius/shadow/type size → token discussion, added to `theme.css`, not a one-off value.
- A utility string appearing a 2nd time → promote to a recipe, named for what it is, not where it's used.
- Everything else → inline utilities at the call site until it repeats.
