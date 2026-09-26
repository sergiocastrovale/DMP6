<script setup lang="ts">
import type { DecadeStats } from '~/types/labs'
import { cx, layout } from '~/helpers/ui'

useTitle('Labs', 'Decade DNA')

definePageMeta({ layout: 'labs' })

const { data: decades, status } = useFetch<DecadeStats[]>('/api/labs/decades/stats')
const { selectedDecades, availableDecades, selectedSeries, toggleDecade } = useDecadeSelection(decades)
</script>

<template>
  <div :class="cx(layout.page, 'max-w-none')">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-2">
        <LabsDecadePicker
          :decades="availableDecades"
          :selected="selectedDecades"
          :loading="status === 'pending'"
          @toggle="toggleDecade"
        />
        <LabsDecadeBreakdown v-if="selectedSeries.length > 0" :series="selectedSeries" />
      </div>

      <div class="lg:col-span-3">
        <LabsDecadeRadar :decades="decades" :selected="selectedDecades" :series="selectedSeries" />
      </div>
    </div>
  </div>
</template>
