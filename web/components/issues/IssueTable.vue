<script setup lang="ts">
import type { IssueColumn, IssueType } from '~/types/issues'
import { cx } from '~/helpers/ui'

const props = defineProps<{
  type: IssueType
  columns: IssueColumn[]
  items: any[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  sort?: string
  order?: 'asc' | 'desc'
  selected: Set<string>
}>()

const emit = defineEmits<{
  'update:selected': [Set<string>]
  sort: [key: string]
  page: [page: number]
  edit: [id: string, key: string, value: unknown]
}>()

const slots = defineSlots<{ [key: `cell-${string}`]: (props: { item: any, value: unknown }) => any }>()

const sanitizeKey = (key: string) => key.replace(/[^a-zA-Z0-9]/g, '_')
const cellSlotName = (key: string) => `cell-${sanitizeKey(key)}` as const

// A column rename in `columns` that isn't mirrored in the consumer's `#cell-*` slot names fails
// silently otherwise: Vue just ignores an unused named slot, and the cell quietly falls back to
// the plain-value renderer instead of the custom one the consumer thought it was still wiring up.
watchEffect(() => {
  const validNames = new Set(props.columns.map(col => cellSlotName(col.key)))
  for (const slotName of Object.keys(slots)) {
    if (!validNames.has(slotName as `cell-${string}`)) {
      console.warn(`[IssueTable] slot "${slotName}" does not match any column key for type "${props.type}" - it will never render. Columns: ${props.columns.map(c => c.key).join(', ')}`)
    }
  }
})

const allChecked = computed(() =>
  props.items.length > 0 && props.items.every(i => props.selected.has(i.id))
)

const totalPages = computed(() => Math.ceil(props.total / props.pageSize))

function toggleAll() {
  const next = new Set(props.selected)
  if (allChecked.value) {
    props.items.forEach(i => next.delete(i.id))
  } else {
    props.items.forEach(i => next.add(i.id))
  }
  emit('update:selected', next)
}

function toggleRow(id: string) {
  const next = new Set(props.selected)
  if (next.has(id)) {next.delete(id)}
  else {next.add(id)}
  emit('update:selected', next)
}

function getNestedValue(obj: any, key: string): unknown {
  return key.split('.').reduce((o, k) => o?.[k], obj)
}

const editingCell = ref<{ id: string; key: string } | null>(null)
const editValue = ref('')

function startEdit(item: any, col: IssueColumn) {
  if (!col.editable) {return}
  editingCell.value = { id: item.id, key: col.editKey ?? col.key }
  editValue.value = String(getNestedValue(item, col.key) ?? '')
}

function commitEdit(item: any, col: IssueColumn) {
  if (!editingCell.value) {return}
  emit('edit', item.id, editingCell.value.key, editValue.value)
  editingCell.value = null
}
</script>

<template>
  <div class="flex flex-col gap-0">
    <SlimTable>
      <SlimTableHeader>
        <th v-if="type !== 'enrichment'" class="w-10 px-3 py-2.5">
          <UiCheckbox :model-value="allChecked" aria-label="Select all rows" @update:model-value="toggleAll" />
        </th>
        <template v-for="col in columns" :key="col.key">
          <SortableTh
            v-if="col.sortable"
            :class="col.width"
            :label="col.label"
            :sort-key="col.key"
            :active-key="sort ?? null"
            :dir="order ?? 'asc'"
            @sort="emit('sort', $event)"
          />
          <th v-else :class="cx('px-3 py-2.5 text-left', col.width)">
            {{ col.label }}
          </th>
        </template>
      </SlimTableHeader>
      <SlimTableBody>
        <template v-if="loading && items.length === 0">
          <tr v-for="n in 5" :key="n" class="border-b border-stone-100/6 last:border-b-0">
            <td v-if="type !== 'enrichment'" class="px-3 py-3">
              <div class="size-4 animate-pulse rounded bg-stone-800" />
            </td>
            <td v-for="col in columns" :key="col.key" class="px-3 py-3">
              <div class="h-4 animate-pulse rounded bg-stone-800" :class="col.width ?? 'w-32'" />
            </td>
          </tr>
        </template>

        <tr v-else-if="!loading && items.length === 0">
          <td :colspan="type !== 'enrichment' ? columns.length + 1 : columns.length">
            <UiEmptyState message="No issues found" />
          </td>
        </tr>

        <SlimTableRow
          v-for="item in items"
          :key="item.id"
          :active="type !== 'enrichment' && selected.has(item.id)"
        >
          <td v-if="type !== 'enrichment'" class="px-3 py-3" @click.stop>
            <UiCheckbox
              :model-value="selected.has(item.id)"
              :aria-label="`Select row ${item.id}`"
              @update:model-value="toggleRow(item.id)"
            />
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-3 py-3 text-stone-100/60"
            :class="col.width"
          >
            <slot :name="cellSlotName(col.key)" :item="item" :value="getNestedValue(item, col.key)">
              <template v-if="col.editable">
                <input
                  v-if="editingCell !== null && editingCell.id === item.id && editingCell.key === (col.editKey ?? col.key)"
                  v-model="editValue"
                  class="w-full rounded-md border border-amber-400/45 bg-stone-950 px-2 py-1 text-base text-stone-100 outline-0"
                  autofocus
                  @blur="commitEdit(item, col)"
                  @keydown.enter="commitEdit(item, col)"
                  @keydown.esc="editingCell = null"
                >
                <span
                  v-else
                  class="cursor-pointer rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-stone-800"
                  @click="startEdit(item, col)"
                >
                  {{ getNestedValue(item, col.key) ?? '-' }}
                </span>
              </template>
              <span v-else class="truncate">{{ getNestedValue(item, col.key) ?? '-' }}</span>
            </slot>
          </td>
        </SlimTableRow>
      </SlimTableBody>
    </SlimTable>

    <div v-if="total > pageSize" class="flex items-center justify-between border-t border-stone-100/6 px-4 py-2.5 text-sm text-stone-100/40">
      <span class="tabular-nums">{{ total }} total</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="page <= 1"
          class="rounded-md px-2 py-1 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-40"
          @click="emit('page', page - 1)"
        >
          Prev
        </button>
        <span class="tabular-nums">{{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          :disabled="page >= totalPages"
          class="rounded-md px-2 py-1 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-40"
          @click="emit('page', page + 1)"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
