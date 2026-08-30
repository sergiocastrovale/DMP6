<script setup lang="ts">
import { ArrowUpDown } from 'lucide-vue-next'

defineProps<{
  active: string
}>()

const emit = defineEmits<{
  select: [sort: string]
}>()

const options = [
  { value: 'name', label: 'Name' },
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
    :icon="ArrowUpDown"
    :allow-clear="false"
    @update:model-value="onUpdate"
  />
</template>
