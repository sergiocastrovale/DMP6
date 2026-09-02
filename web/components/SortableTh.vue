<script setup lang="ts">
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-vue-next'
import type { SortDirection } from '~/types/common'
import { cx, data } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  label: string
  sortKey: string
  activeKey: string | null
  dir: SortDirection
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
    :class="cx(data.th, align === 'right' ? 'text-right' : 'text-left')"
  >
    <UiButton
      variant="ghost"
      size="sm"
      :icon="align === 'right' ? icon : undefined"
      :trailing-icon="align === 'right' ? undefined : icon"
      :icon-class="active ? 'text-stone-100' : undefined"
      :title="`Sort by ${label}`"
      @click="emit('sort', sortKey)"
    >
      <span :class="active && 'text-stone-100'">{{ label }}</span>
    </UiButton>
  </th>
</template>
