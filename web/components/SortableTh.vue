<script setup lang="ts">
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-vue-next'
import type { SortDir } from '~/helpers/functions'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  label: string
  sortKey: string
  activeKey: string | null
  dir: SortDir
  align?: 'left' | 'right'
}>(), {
  align: 'left',
})

const emit = defineEmits<{ sort: [key: string] }>()

const active = computed(() => props.activeKey === props.sortKey)
const icon = computed(() => (active.value ? (props.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown))
const ariaSort = computed<'ascending' | 'descending' | 'none'>(() =>
  active.value ? (props.dir === 'asc' ? 'ascending' : 'descending') : 'none')
</script>

<template>
  <th
    :aria-sort="ariaSort"
    :class="cx('px-3 py-2.5', align === 'right' ? 'text-right' : 'text-left')"
  >
    <button
      type="button"
      :class="cx(
        'inline-flex items-center gap-1 transition-colors duration-150 hover:text-stone-100',
        active ? 'text-stone-100/60' : '',
        align === 'right' ? 'flex-row-reverse' : '',
      )"
      :title="`Sort by ${label}`"
      @click="emit('sort', sortKey)"
    >
      {{ label }}
      <component :is="icon" :size="11" :stroke-width="ICON_STROKE_WIDTH" :class="active ? 'text-amber-400' : 'text-stone-100/50'" />
    </button>
  </th>
</template>
