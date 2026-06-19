<script setup lang="ts">
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next'
import type { SortDir } from '~/helpers/functions'

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
</script>

<template>
  <th class="px-4 py-2 font-medium" :class="align === 'right' ? 'text-right' : 'text-left'">
    <button
      type="button"
      class="inline-flex items-center gap-1 transition-colors hover:text-ink-2"
      :class="[active ? 'text-ink-2' : '', align === 'right' ? 'flex-row-reverse' : '']"
      @click="emit('sort', sortKey)"
    >
      {{ label }}
      <component :is="icon" :size="12" :class="active ? 'opacity-100' : 'opacity-40'" />
    </button>
  </th>
</template>
