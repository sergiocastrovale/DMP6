<script setup lang="ts">
defineProps<{
  active: string
}>()

const emit = defineEmits<{
  select: [sort: string]
}>()

// The columns the summarized table also offers as sortable headers are here too, so the two
// controls stay interchangeable rather than each reaching a subset of the orders.
const options = [
  { value: 'name', label: 'Name' },
  { value: 'releases', label: 'Releases' },
  { value: 'tracks', label: 'Tracks' },
  { value: 'completeness', label: 'Completeness' },
  { value: 'playCount', label: 'Play count' },
  { value: 'score', label: 'Match score' },
  { value: 'recent', label: 'Recently added' },
]

// Dropdown's contract allows a null selection (for filters with a "show everything" state);
// this control never has one, so the emitted value is never actually null in practice.
const onUpdate = (value: string | null) => {
  if (value) {
    emit('select', value)
  }
}
</script>

<template>
  <Dropdown
    :model-value="active"
    :options="options"
    :allow-clear="false"
    @update:model-value="onUpdate"
  />
</template>
