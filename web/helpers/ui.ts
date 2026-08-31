// Design-system recipe layer: composed Tailwind utility strings built on the tokens in
// assets/css/theme.css. One definition per repeated pattern - a screen that needs something
// new builds it from utilities in place, and only gets promoted here once it repeats a second
// time (see docs/design_system.md). Never redefine a recipe locally; extend with cx().

export const cx = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ')

// The system's icon weight (lucide-vue-next defaults to 2). Pass to every Lucide icon so the
// whole app reads as one stroke weight instead of whatever each call site happened to leave.
export const ICON_STROKE_WIDTH = 1.6

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
export type ToggleKey = 'tab' | 'chip' | 'keyChip' | 'switchBtn' | 'countPill' | 'underTab'

interface ButtonVariantSpec {
  // Shape only - never a colour, so it can sit next to either `idle` or `on` below it.
  structural: string
  idle: string
  // Only variants that are ever used as a toggle (filter/toolbar buttons) define this.
  on?: string
}

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 font-sans whitespace-nowrap cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-default'

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[11px] text-sm',
  md: 'h-[34px] px-4 text-base',
  lg: 'h-[40px] px-5 text-lg',
}

// Square, label-less variant of the same heights - kept apart from BUTTON_SIZE (rather than
// added on top of it) so an icon-only button never carries both a horizontal-padding utility
// and a `p-0` meant to cancel it. Same-property utilities resolve by stylesheet order, not by
// which one a caller lists last, so the only safe fix is to never emit both.
const BUTTON_ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  sm: 'size-[30px] p-0',
  md: 'size-[34px] p-0',
  lg: 'size-[40px] p-0',
}

// `structural` (shape) and `idle`/`on` (colour) are kept apart on purpose: Tailwind resolves
// two utilities that touch the same CSS property by stylesheet order, not by which one appears
// later in a class string, so a toggle state must REPLACE the colour pair, never sit next to it.
const BUTTON_VARIANT: Record<ButtonVariant, ButtonVariantSpec> = {
  primary: {
    structural: 'rounded-full font-semibold border-0 active:scale-[.98]',
    idle: 'bg-amber-400 text-on-accent hover:brightness-110',
  },
  secondary: {
    structural: 'rounded-full border',
    idle: 'bg-stone-800 border-stone-100/10 text-stone-100/60 hover:bg-stone-700 hover:text-stone-100',
    on: 'border-amber-400/45 bg-amber-400/15 text-amber-400 font-medium',
  },
  quiet: {
    structural: 'rounded-md border',
    idle: 'bg-stone-900 border-stone-100/10 text-stone-100/60 hover:bg-stone-800 hover:text-stone-100',
    on: 'border-amber-400/45 bg-amber-400/15 text-amber-400 font-medium',
  },
  danger: {
    structural: 'rounded-full font-semibold border-0',
    idle: 'bg-danger text-white hover:brightness-110',
  },
  ghost: {
    structural: 'rounded-md border',
    idle: 'bg-transparent border-transparent text-stone-100/40 hover:text-stone-100 hover:bg-stone-800',
    on: 'border-amber-400/45 bg-amber-400/10 text-amber-400 font-medium',
  },
}

// button(variant, size, extra, on, iconOnly) - the only way a <button> gets its classes. Pass
// on=true for a pressed/selected toggle (filter chips styled as buttons, view-mode switches,
// ...). Variants with no dedicated `on` colour (primary, danger are actions, not toggles) fall
// back to an outline ring layered on top of their idle colour instead of silently ignoring the
// flag. Pass iconOnly=true for a square, label-less button - never combine it with `extra`
// padding/sizing utilities for the same reason described on BUTTON_ICON_ONLY_SIZE above.
export const button = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
  on = false,
  iconOnly = false,
): string => {
  const spec = BUTTON_VARIANT[variant]
  const color = on ? spec.on ?? cx('outline outline-2 outline-offset-2 outline-amber-400/60', spec.idle) : spec.idle
  const sizeClass = iconOnly ? BUTTON_ICON_ONLY_SIZE[size] : BUTTON_SIZE[size]
  return cx(BUTTON_BASE, sizeClass, spec.structural, color, extra)
}

export const iconButton = 'grid place-items-center rounded-md bg-transparent border border-transparent text-stone-100/40 hover:text-stone-100 hover:bg-stone-800 transition-colors duration-150'

// Shared wrapper for a segmented control (radio group, view-mode switch): a bordered pill
// holding tightly-packed toggle buttons.
export const segmentGroup = 'inline-flex items-center gap-0.5 rounded-md border border-stone-100/10 bg-stone-900 p-0.5'

interface ToggleSpec {
  base: string
  idle: string
  on: string
}

// Non-button toggles (pill tabs, filter chips, letter keys, segmented switches, count badges,
// underline tabs). Same idle/on-replaces-idle contract as the button recipe above.
const TOGGLE: Record<ToggleKey, ToggleSpec> = {
  tab: {
    base: 'inline-flex items-center gap-2 h-[30px] px-[13px] rounded-full text-base font-sans cursor-pointer transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100',
    idle: 'bg-transparent text-stone-100/40',
    on: 'bg-amber-400/20 text-amber-400 font-semibold',
  },
  chip: {
    base: 'inline-flex items-center gap-1.5 h-[30px] px-[11px] rounded-md border text-sm font-sans whitespace-nowrap cursor-pointer transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100',
    idle: 'bg-stone-900 border-stone-100/10 text-stone-100/60',
    on: 'bg-amber-400/20 border-amber-400/45 text-amber-400 font-semibold',
  },
  keyChip: {
    base: 'h-7 min-w-7 px-2 rounded-[7px] border border-transparent text-sm font-semibold font-sans cursor-pointer transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100',
    idle: 'bg-transparent text-stone-100/40',
    on: 'bg-amber-400 text-on-accent',
  },
  switchBtn: {
    base: 'grid place-items-center size-[30px] rounded-sm border-0 cursor-pointer transition-colors duration-150 hover:text-stone-100',
    idle: 'bg-transparent text-stone-100/40',
    on: 'bg-stone-700 text-stone-100',
  },
  countPill: {
    base: 'inline-flex items-center h-[19px] px-2 rounded-full text-2xs font-bold tabular-nums',
    idle: 'bg-stone-800 text-stone-100/40',
    on: 'bg-amber-400/20 text-amber-400',
  },
  underTab: {
    base: 'relative inline-flex items-center gap-2 h-[40px] px-[14px] bg-transparent border-0 text-lg font-sans cursor-pointer after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full hover:text-stone-100',
    idle: 'text-stone-100/40',
    on: 'text-stone-100 font-semibold after:bg-amber-400',
  },
}

// sw('tab', active) -> ui.tab base classes + (active ? on : idle)
export const sw = (key: ToggleKey, on: boolean): string => {
  const spec = TOGGLE[key]
  return cx(spec.base, on ? spec.on : spec.idle)
}

// tone -> colour, used for status/severity everywhere (release status, download state,
// confidence, issue severity). One source; see helpers/constants.ts `statuses`.
export const toneText: Record<Tone, string> = {
  accent: 'text-amber-400',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  muted: 'text-stone-100/40',
}

export const toneBg: Record<Tone, string> = {
  accent: 'bg-amber-400/20 text-amber-400',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
  muted: 'bg-stone-800 text-stone-100/40',
}

export const toneFill: Record<Tone, string> = {
  accent: 'bg-amber-400',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  muted: 'bg-stone-100/30',
}

export const surface = {
  card: 'rounded-xl border border-stone-100/6 bg-stone-900',
  cardHead: 'flex items-center justify-between gap-3 px-[18px] py-[14px] border-b border-stone-100/6',
  cardBody: 'p-[18px] flex flex-col gap-4',
  panel: 'rounded-lg border border-stone-100/6 bg-stone-950',
  popover: 'rounded-lg border border-stone-100/10 bg-stone-900 shadow-lg',
  divider: 'border-b border-stone-100/6',
}

export const form = {
  input: 'h-[40px] w-full px-[13px] rounded-md bg-stone-950 border border-stone-100/10 text-stone-100 text-base font-sans outline-0 transition-colors duration-150 focus:border-amber-400/45 focus:bg-stone-800 placeholder:text-stone-100/30',
  inputInvalid: 'border-danger/65',
  label: 'text-base font-medium text-stone-100',
  hint: 'text-sm text-stone-100/40 leading-[1.45] -mt-0.5',
  error: 'text-sm text-danger',
  select: 'h-[40px] w-full pl-[13px] pr-8 rounded-md bg-stone-950 border border-stone-100/10 text-stone-100 text-base font-sans appearance-none outline-0 focus:border-amber-400/45',
  checkbox: 'relative grid place-items-center size-[18px] rounded-[5px] border border-stone-100/10 bg-stone-950 [&:has(:checked)]:bg-amber-400 [&:has(:checked)]:border-amber-400',
  search: 'flex items-center gap-[9px] h-[34px] px-3 rounded-md bg-stone-900 border border-stone-100/10 focus-within:border-amber-400/40',
  searchInput: 'flex-1 min-w-0 bg-transparent border-0 outline-0 text-stone-100 text-base font-sans placeholder:text-stone-100/30',
}

export const nav = {
  item: 'flex items-center gap-3.5 px-3 py-2.5 rounded-md text-lg font-normal text-stone-100/60 whitespace-nowrap cursor-pointer transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100',
  itemActive: 'bg-amber-400/20 text-amber-400 font-medium',
}

export const data = {
  row: 'flex items-center justify-between gap-3.5 w-full px-[18px] py-3 border-b border-stone-100/6 last:border-b-0 text-base',
  rowLink: 'cursor-pointer hover:bg-stone-800',
  th: 'px-3 py-2.5 text-left text-2xs font-bold tracking-[0.1em] uppercase text-stone-100/40 border-b border-stone-100/6 whitespace-nowrap',
  td: 'px-3 py-3 text-base text-stone-100/60 border-b border-stone-100/6 align-middle',
  tag: 'inline-flex items-center h-[22px] px-2.5 rounded-full bg-stone-800 border border-stone-100/6 text-xs text-stone-100/60',
  badge: 'inline-flex items-center h-[22px] px-2.5 rounded-full text-sm font-bold tabular-nums',
}

export const grid = {
  auto: 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-[22px] gap-y-[26px]',
  autoSm: 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5',
  empty: 'col-span-full py-10 text-center text-base text-stone-100/40',
}

export const tile = {
  root: 'group block min-w-0 text-left',
  art: 'w-full aspect-square rounded-lg bg-stone-800 border border-stone-100/6 overflow-hidden transition-colors duration-150 group-hover:border-stone-100/10',
  name: 'mt-2.5 text-lg font-semibold text-stone-100 truncate',
  sub: 'mt-0.5 text-sm text-stone-100/40',
  meta: 'mt-0.5 text-2xs text-stone-100/30',
}

export const typography = {
  h1: 'font-display text-4xl font-bold tracking-[-0.03em]',
  h2: 'font-display text-3xl font-bold tracking-[-0.025em]',
  h3: 'font-display text-2xl font-semibold tracking-[-0.02em]',
  title: 'text-xl font-semibold tracking-[-0.01em]',
  body: 'text-base text-stone-100/60 leading-[1.55]',
  sub: 'text-sm text-stone-100/40',
  sectionLabel: 'text-2xs font-bold tracking-[0.12em] uppercase text-stone-100/60',
  meta: 'font-mono text-xs text-stone-100/40 tabular-nums',
  // Wider-tracked monospace caption that sits *above* a value rather than beside it - the
  // "TOTAL PLAYTIME" rule on Statistics, the "STATUS" lead-in on the artist page. Distinct from
  // sectionLabel (sans, card headers) and from meta (numerals inside a row).
  eyebrow: 'inline-flex items-center gap-2 font-mono text-2xs tracking-[0.24em] uppercase text-stone-100/40',
}

// A pill that carries its colour as a *border + tinted fill* rather than a solid one: match-score
// bands, completeness, Labs maturity. Pair it with a toneBg entry (or a scoreRanges bg/text pair)
// for the colour - this recipe is shape only, so the two never fight over the same property.
export const outlinePill = 'inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full border text-sm font-bold tabular-nums'

export const layout = {
  page: 'w-full max-w-[1600px] mx-auto px-10 pt-[30px] pb-12',
  topbar: 'sticky top-0 z-10 flex items-center gap-3 h-[56px] px-7 bg-stone-950/85 backdrop-blur-[14px] border-b border-stone-100/6',
  scrim: 'fixed inset-0 z-50 grid place-items-center bg-black/62 backdrop-blur-[3px] p-6',
  dialog: 'w-full rounded-2xl border border-stone-100/10 bg-stone-900 shadow-xl p-[22px]',
  pageHead: 'flex items-baseline justify-between gap-4 mb-[22px]',
  toolbar: 'flex items-center gap-2.5 flex-wrap mb-4',
  spacer: 'flex-1 min-w-0',
}

// Single bundle for call sites that want `ui.card` / `ui.form.input` ergonomics instead of one
// import per namespace. Named exports above stay the source of truth for anything that imports
// a single group directly (e.g. `import { form } from '~/helpers/ui'`).
export const ui = {
  ...surface,
  form,
  nav,
  data,
  grid,
  tile,
  typography,
  layout,
  toneText,
  toneBg,
  toneFill,
  iconButton,
  outlinePill,
}
