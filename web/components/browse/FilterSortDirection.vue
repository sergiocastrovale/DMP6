<script setup lang="ts">
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-vue-next'
import type { SortDirection } from '~/types/common'

// Direction is its own control rather than extra entries in the sort dropdown: the dropdown answers
// "by what", this answers "which end first", and folding them together doubles that list every time
// a sortable column is added.
const props = defineProps<{
  direction: SortDirection
}>()

const emit = defineEmits<{ toggle: [] }>()

const label = computed(() => (props.direction === 'asc' ? 'Sort ascending' : 'Sort descending'))
</script>

<template>
  <UiButton
    variant="quiet"
    icon-only
    :icon="direction === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow"
    :aria-label="label"
    :title="label"
    @click="emit('toggle')"
  />
</template>
