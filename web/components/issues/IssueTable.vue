<script setup lang="ts">
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next'
import type { IssueColumn, IssueType } from '~/types/issues'

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
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-rule text-left">
            <th v-if="type !== 'enrichment'" class="w-10 px-3 py-2">
              <input type="checkbox" :checked="allChecked" class="rounded border-rule bg-bg-2" @change="toggleAll" >
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2 text-xs font-medium text-ink0"
              :class="[col.width, col.sortable ? 'cursor-pointer select-none hover:text-ink-2' : '']"
              @click="col.sortable && emit('sort', col.key)"
            >
              <span class="flex items-center gap-1">
                {{ col.label }}
                <template v-if="col.sortable">
                  <ChevronUp v-if="sort === col.key && order === 'asc'" :size="12" />
                  <ChevronDown v-else-if="sort === col.key && order === 'desc'" :size="12" />
                  <ChevronsUpDown v-else :size="12" class="opacity-30" />
                </template>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-if="loading && items.length === 0">
            <tr v-for="n in 5" :key="n" class="border-b border-rule/50">
              <td v-if="type !== 'enrichment'" class="px-3 py-2.5">
                <div class="h-4 w-4 animate-pulse rounded bg-bg-2" />
              </td>
              <td v-for="col in columns" :key="col.key" class="px-3 py-2.5">
                <div class="h-4 animate-pulse rounded bg-bg-2" :class="col.width ?? 'w-32'" />
              </td>
            </tr>
          </template>

          <tr v-else-if="!loading && items.length === 0">
            <td :colspan="type !== 'enrichment' ? columns.length + 1 : columns.length" class="px-3 py-12 text-center text-ink0">
              No issues found
            </td>
          </tr>

          <tr
            v-for="item in items"
            :key="item.id"
            class="border-b border-rule/50 transition-colors hover:bg-bg-1/30"
            :class="type !== 'enrichment' && selected.has(item.id) ? 'bg-blue-950/20' : ''"
          >
            <td v-if="type !== 'enrichment'" class="px-3 py-2">
              <input
                type="checkbox"
                :checked="selected.has(item.id)"
                class="rounded border-rule bg-bg-2"
                @change="toggleRow(item.id)"
              >
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2 text-ink-2"
              :class="col.width"
            >
              <slot :name="`cell-${col.key.replace(/[^a-zA-Z0-9]/g, '_')}`" :item="item" :value="getNestedValue(item, col.key)">
                <template v-if="col.editable">
                  <input
                    v-if="editingCell !== null && editingCell.id === item.id && editingCell.key === (col.editKey ?? col.key)"
                    v-model="editValue"
                    class="w-full rounded border border-blue-500 bg-bg-1 px-2 py-0.5 text-sm outline-none"
                    autofocus
                    @blur="commitEdit(item, col)"
                    @keydown.enter="commitEdit(item, col)"
                    @keydown.esc="editingCell = null"
                  >
                  <span
                    v-else
                    class="cursor-pointer rounded px-1 py-0.5 hover:bg-bg-2"
                    @click="startEdit(item, col)"
                  >
                    {{ getNestedValue(item, col.key) ?? '-' }}
                  </span>
                </template>
                <span v-else class="truncate">{{ getNestedValue(item, col.key) ?? '-' }}</span>
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > pageSize" class="flex items-center justify-between border-t border-rule px-4 py-2 text-xs text-ink0">
      <span>{{ total }} total</span>
      <div class="flex items-center gap-2">
        <button
          :disabled="page <= 1"
          class="rounded px-2 py-1 hover:bg-bg-2 disabled:opacity-40"
          @click="emit('page', page - 1)"
        >
          Prev
        </button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button
          :disabled="page >= totalPages"
          class="rounded px-2 py-1 hover:bg-bg-2 disabled:opacity-40"
          @click="emit('page', page + 1)"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
