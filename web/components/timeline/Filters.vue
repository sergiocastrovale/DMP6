<script setup lang="ts">
import type { Decade, YearCount } from '~/types/timeline'
import { sw } from '~/helpers/ui'

defineProps<{
  decades: Decade[]
  selectedDecade: number | null
  years: YearCount[]
  selectedYear: number | null
}>()

defineEmits<{
  'select-decade': [decade: number]
  'select-year': [year: number | null]
}>()
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="d in decades"
      :key="d.decade"
      type="button"
      :class="sw('chip', selectedDecade === d.decade)"
      @click="$emit('select-decade', d.decade)"
    >
      {{ d.decade }}s
      <span class="opacity-70">({{ d.count }})</span>
    </button>
  </div>

  <div v-if="years.length > 1" class="flex flex-wrap gap-1.5">
    <button
      type="button"
      :class="sw('chip', selectedYear === null)"
      @click="$emit('select-year', null)"
    >
      All
    </button>
    <button
      v-for="y in years"
      :key="y.year"
      type="button"
      :class="sw('chip', selectedYear === y.year)"
      @click="$emit('select-year', y.year)"
    >
      {{ y.year }}
      <span class="opacity-70">({{ y.count }})</span>
    </button>
  </div>
</template>
