<script setup lang="ts">
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-vue-next'
import type { SortDir } from '~/helpers/functions'
import { cx, data } from '~/helpers/ui'

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
    :class="cx(data.th, align === 'right' ? 'text-right' : 'text-left')"
  >
    <UiButton
      variant="ghost"
      size="sm"
      :on="active"
      :icon="align === 'right' ? icon : undefined"
      :trailing-icon="align === 'right' ? undefined : icon"
      :title="`Sort by ${label}`"
      @click="emit('sort', sortKey)"
    >
      {{ label }}
    </UiButton>
  </th>
</template>
