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
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:selected', next)
}

function getNestedValue(obj: any, key: string): unknown {
  return key.split('.').reduce((o, k) => o?.[k], obj)
}

const editingCell = ref<{ id: string; key: string } | null>(null)
const editValue = ref('')

function startEdit(item: any, col: IssueColumn) {
  if (!col.editable) return
  editingCell.value = { id: item.id, key: col.editKey ?? col.key }
  editValue.value = String(getNestedValue(item, col.key) ?? '')
}

function commitEdit(item: any, col: IssueColumn) {
  if (!editingCell.value) return
  emit('edit', item.id, editingCell.value.key, editValue.value)
  editingCell.value = null
}
</script>

<template>
  <div class="flex flex-col gap-0">
    <!-- Table -->
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-800 text-left">
            <th class="w-10 px-3 py-2">
              <input type="checkbox" :checked="allChecked" @change="toggleAll" class="rounded border-zinc-600 bg-zinc-800" />
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2 text-xs font-medium text-zinc-500"
              :class="[col.width, col.sortable ? 'cursor-pointer select-none hover:text-zinc-300' : '']"
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
          <!-- Loading skeleton -->
          <template v-if="loading && items.length === 0">
            <tr v-for="n in 5" :key="n" class="border-b border-zinc-800/50">
              <td class="px-3 py-2.5">
                <div class="h-4 w-4 animate-pulse rounded bg-zinc-800" />
              </td>
              <td v-for="col in columns" :key="col.key" class="px-3 py-2.5">
                <div class="h-4 animate-pulse rounded bg-zinc-800" :class="col.width ?? 'w-32'" />
              </td>
            </tr>
          </template>

          <!-- Empty state -->
          <tr v-else-if="!loading && items.length === 0">
            <td :colspan="columns.length + 1" class="px-3 py-12 text-center text-zinc-500">
              No issues found
            </td>
          </tr>

          <!-- Rows -->
          <tr
            v-for="item in items"
            :key="item.id"
            class="border-b border-zinc-800/50 transition-colors hover:bg-zinc-900/30"
            :class="selected.has(item.id) ? 'bg-blue-950/20' : ''"
          >
            <td class="px-3 py-2">
              <input
                type="checkbox"
                :checked="selected.has(item.id)"
                @change="toggleRow(item.id)"
                class="rounded border-zinc-600 bg-zinc-800"
              />
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2 text-zinc-300"
              :class="col.width"
            >
              <!-- Custom slot: dots in key replaced with underscores in slot name -->
              <slot :name="`cell-${col.key.replace(/[^a-zA-Z0-9]/g, '_')}`" :item="item" :value="getNestedValue(item, col.key)">
                <!-- Editable cell -->
                <template v-if="col.editable">
                  <input
                    v-if="editingCell !== null && editingCell.id === item.id && editingCell.key === (col.editKey ?? col.key)"
                    v-model="editValue"
                    class="w-full rounded border border-blue-500 bg-zinc-900 px-2 py-0.5 text-sm outline-none"
                    @blur="commitEdit(item, col)"
                    @keydown.enter="commitEdit(item, col)"
                    @keydown.esc="editingCell = null"
                    autofocus
                  />
                  <span
                    v-else
                    class="cursor-pointer rounded px-1 py-0.5 hover:bg-zinc-800"
                    @click="startEdit(item, col)"
                  >
                    {{ getNestedValue(item, col.key) ?? '—' }}
                  </span>
                </template>
                <!-- Plain value -->
                <span v-else class="truncate">{{ getNestedValue(item, col.key) ?? '—' }}</span>
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="total > pageSize" class="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
      <span>{{ total }} total</span>
      <div class="flex items-center gap-2">
        <button
          :disabled="page <= 1"
          @click="emit('page', page - 1)"
          class="rounded px-2 py-1 hover:bg-zinc-800 disabled:opacity-40"
        >
          Prev
        </button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button
          :disabled="page >= totalPages"
          @click="emit('page', page + 1)"
          class="rounded px-2 py-1 hover:bg-zinc-800 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
