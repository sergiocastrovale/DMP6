import type { Component } from 'vue'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'success' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'
export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
export type ToggleKey = 'tab' | 'chip' | 'keyChip' | 'switchBtn' | 'countPill' | 'underTab'

export interface ButtonVariantSpec {
  // Shape only - never a colour, so it can sit next to either `idle` or `on` below it.
  structural: string
  idle: string
  // Only variants that are ever used as a toggle (filter/toolbar buttons) define this.
  on?: string
}

export interface ToggleSpec {
  base: string
  idle: string
  on: string
}

export interface SubtabItem {
  key: string
  label: string
  count?: number
  activeColor?: string
}

export interface DataTableColumn {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right'
  width?: string
  // Responsive visibility (e.g. `hidden md:table-cell`) - applied to both the header and every
  // row's cell for this column, since hiding only the cell content would leave an empty <td>
  // still taking up a column in the table's layout.
  class?: string
}

export interface DataTableBulkAction<Row> {
  key: string
  label: string
  icon?: Component
  variant?: ButtonVariant
  onClick: (rows: Row[]) => void
}

export interface ToggleOption {
  value: string
  icon: Component
  title: string
}

export interface DropdownOption {
  value: string
  label: string
  classes?: string
}

export type LoadingPanelSize = 'sm' | 'md'

export type ToastSize = 'sm' | 'md' | 'lg'

export interface NavEntry {
  to?: string
  activePath?: string
  label: string
  icon: Component
  count?: number | null
  action?: () => void
}

export interface SearchDropdownProps {
  results: import('./search').SearchResults | null
  listboxId?: string
  activeIndex?: number
}

export interface BarAction {
  key: string
  label: string
  icon?: Component
  // The button recipe's own union rather than a local copy of it - the copy had already drifted,
  // missing `quiet`, which is the variant the bar's own amber strip calls for.
  variant?: ButtonVariant
}

export interface RadioOption {
  value: string
  label: string
}

export interface ScoreRangeFilterProps {
  minScore: number | null
  maxScore: number | null
}

export interface TabItem {
  key: string
  label: string
  href?: string
  count?: number
  countHighlight?: boolean
}

export interface ButtonDropdownOption {
  label: string
  description?: string
  icon?: Component
  action: () => void
}

export interface TrackListColumn {
  key: 'play' | 'release' | 'trackNumber' | 'title' | 'artist' | 'status' | 'playCount' | 'favorite' | 'duration'
  label?: string
}

export type ToastKind = 'error' | 'success' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}
