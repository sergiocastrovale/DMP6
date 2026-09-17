<script setup lang="ts">
import { useBrowseStore } from '~/stores/browse'
import { browseSortPairOptions, completenessRanges } from '~/helpers/constants'
import { cx, sw } from '~/helpers/ui'

const store = useBrowseStore()

const modelValue = defineModel<boolean>({ required: true })

const selectCompleteness = (range: typeof completenessRanges[number]) => {
  const isActive = store.minCompleteness === range.min && store.maxCompleteness === range.max
  store.setCompletenessRange(isActive ? null : range.min, isActive ? null : range.max)
}
</script>

<template>
  <UiFiltersSidebar v-model="modelValue" :active-count="store.activeFilterCount" @clear="store.clearFilters">
    <template #header-extra>
      <UiSpinner v-if="store.loading" :size="14" />
    </template>

    <UiFilterSection title="Sort by">
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="option in browseSortPairOptions"
          :key="`${option.sortBy}-${option.sortDir}`"
          type="button"
          :class="cx(sw('chip', store.sortBy === option.sortBy && store.sortDir === option.sortDir), 'justify-center')"
          @click="store.setSort(option.sortBy, option.sortDir)"
        >
          {{ option.label }}
        </button>
      </div>
    </UiFilterSection>

    <hr class="my-5 border-stone-100/6">

    <UiFilterSection title="Genre">
      <BrowseFiltersGenre />
    </UiFilterSection>

    <hr class="my-5 border-stone-100/6">

    <UiFilterSection title="Completeness">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="range in completenessRanges"
          :key="range.label"
          type="button"
          :aria-pressed="store.minCompleteness === range.min && store.maxCompleteness === range.max"
          :class="cx(
            'flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium transition-colors duration-150 cursor-pointer',
            store.minCompleteness === range.min && store.maxCompleteness === range.max
              ? cx(range.bgColor, range.textColor)
              : 'bg-stone-800 text-stone-100/55 hover:bg-stone-700',
          )"
          @click="selectCompleteness(range)"
        >
          <span class="size-2 shrink-0 rounded-full" :class="range.color" />
          {{ range.label }}
        </button>
      </div>
    </UiFilterSection>
  </UiFiltersSidebar>
</template>
