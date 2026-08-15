<script setup lang="ts">
import { ArrowUpDown } from 'lucide-vue-next'

const props = defineProps<{
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
</script>

<template>
  <div class="flex items-center gap-2">
    <ArrowUpDown :size="14" class="text-ink-3" />
    <select
      :value="active"
      class="rounded-lg border border-rule bg-bg-1 px-3 py-1.5 text-xs text-ink-2 focus:border-accent focus:outline-none"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>
