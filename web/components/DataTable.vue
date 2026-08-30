<script setup lang="ts" generic="T extends object">
import type { Component } from 'vue'
import type { SortDir } from '~/helpers/functions'
import type { ButtonVariant } from '~/helpers/ui'
import { button, cx } from '~/helpers/ui'

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

const props = withDefaults(defineProps<{
  columns: DataTableColumn[]
  rows: T[]
  getRowId?: (row: T) => string | number
  rowLabel?: (row: T) => string
  selectable?: boolean
  loading?: boolean
  loadingRows?: number
  emptyMessage?: string
  emptyHint?: string
  sort?: { key: string | null, dir: SortDir }
  selected?: Set<string | number>
  bulkActions?: DataTableBulkAction<T>[]
}>(), {
  selectable: true,
  loading: false,
  loadingRows: 5,
  emptyMessage: 'No rows.',
})

const emit = defineEmits<{
  sort: [key: string]
  'update:selected': [selected: Set<string | number>]
}>()

const slots = defineSlots<{
  actions?: (props: { row: T }) => any
  [key: `cell-${string}`]: (props: { row: T, value: unknown }) => any
}>()

const rowId = (row: T): string | number => (props.getRowId ? props.getRowId(row) : (row as unknown as { id: string | number }).id)
const rowAriaLabel = (row: T): string => props.rowLabel ? props.rowLabel(row) : `row ${rowId(row)}`

const selectedIds = computed(() => props.selected ?? new Set<string | number>())
const allIds = computed(() => props.rows.map(rowId))
const allChecked = computed(() => props.selectable && allIds.value.length > 0 && allIds.value.every(id => selectedIds.value.has(id)))
const someChecked = computed(() => props.selectable && selectedIds.value.size > 0 && !allChecked.value)
const selectedRows = computed(() => props.rows.filter(row => selectedIds.value.has(rowId(row))))

const toggleAll = () => {
  emit('update:selected', allChecked.value ? new Set() : new Set(allIds.value))
}

const toggleRow = (id: string | number) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  }
  else {
    next.add(id)
  }
  emit('update:selected', next)
}

const clearSelection = () => emit('update:selected', new Set())

const hasActionsSlot = computed(() => !!slots.actions)
const columnCount = computed(() => props.columns.length + (props.selectable ? 1 : 0) + (hasActionsSlot.value ? 1 : 0))

const cellSlotName = (key: string) => `cell-${key}` as const
const hasCellSlot = (key: string) => !!slots[cellSlotName(key)]
const cellValue = (row: T, key: string) => (row as unknown as Record<string, unknown>)[key]
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-if="selectable && selectedIds.size > 0" class="flex items-center justify-between gap-4 px-4 h-[42px] rounded-lg bg-amber-400/20 border border-amber-400/30 text-base text-amber-400">
      <span class="font-medium">{{ selectedIds.size }} selected</span>
      <div class="flex items-center gap-2">
        <button
          v-for="action in bulkActions"
          :key="action.key"
          type="button"
          :class="button(action.variant ?? 'quiet', 'sm', 'bg-stone-900/60')"
          @click="action.onClick(selectedRows)"
        >
          <component :is="action.icon" v-if="action.icon" :size="13" />
          {{ action.label }}
        </button>
        <button type="button" :class="button('ghost', 'sm')" @click="clearSelection">
          Cancel
        </button>
      </div>
    </div>

    <SlimTable>
      <SlimTableHeader>
        <th v-if="selectable" class="w-10 px-3 py-2.5">
          <UiCheckbox
            :model-value="allChecked"
            :indeterminate="someChecked"
            aria-label="Select all rows"
            @update:model-value="toggleAll"
          />
        </th>
        <template v-for="col in columns" :key="col.key">
          <SortableTh
            v-if="col.sortable"
            :class="col.class"
            :label="col.label"
            :sort-key="col.key"
            :active-key="sort?.key ?? null"
            :dir="sort?.dir ?? 'asc'"
            :align="col.align"
            @sort="emit('sort', $event)"
          />
          <th
            v-else
            :class="cx('px-3 py-2.5', col.align === 'right' ? 'text-right' : 'text-left', col.class)"
            :style="col.width ? { width: col.width } : undefined"
          >
            {{ col.label }}
          </th>
        </template>
        <th v-if="hasActionsSlot" class="px-3 py-2.5 text-right">
          Actions
        </th>
      </SlimTableHeader>
      <SlimTableBody>
        <template v-if="loading">
          <tr v-for="i in loadingRows" :key="i" class="border-b border-stone-100/6 last:border-b-0">
            <td :colspan="columnCount" class="px-3 py-3">
              <div class="h-4 w-full max-w-xs animate-pulse rounded bg-stone-800" />
            </td>
          </tr>
        </template>
        <tr v-else-if="rows.length === 0">
          <td :colspan="columnCount">
            <UiEmptyState :message="emptyMessage" :hint="emptyHint" />
          </td>
        </tr>
        <template v-else>
          <SlimTableRow
            v-for="row in rows"
            :key="rowId(row)"
            :active="selectedIds.has(rowId(row))"
          >
            <td v-if="selectable" class="w-10 px-3 py-2.5" @click.stop>
              <UiCheckbox
                :model-value="selectedIds.has(rowId(row))"
                :aria-label="`Select ${rowAriaLabel(row)}`"
                @update:model-value="toggleRow(rowId(row))"
              />
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              :class="cx('px-3 py-3', col.align === 'right' && 'text-right', col.class)"
            >
              <slot v-if="hasCellSlot(col.key)" :name="cellSlotName(col.key)" :row="row" :value="cellValue(row, col.key)" />
              <span v-else :class="col.align === 'right' && 'tabular-nums'">{{ cellValue(row, col.key) }}</span>
            </td>
            <td v-if="hasActionsSlot" class="px-3 py-3 text-right" @click.stop>
              <slot name="actions" :row="row" />
            </td>
          </SlimTableRow>
        </template>
      </SlimTableBody>
    </SlimTable>
  </div>
</template>
