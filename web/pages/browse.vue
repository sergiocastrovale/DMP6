<script setup lang="ts">
import { useBrowseStore } from '~/stores/browse'
import { browseFilterSummary } from '~/helpers/browseFilterSummary'
import { layout } from '~/helpers/ui'

useTitle('Browse')

const store = useBrowseStore()

// Sort is always shown (it always has a value); genre/completeness only join in once set.
const filterSummary = computed(() => browseFilterSummary(store))
</script>

<template>
  <div :class="layout.page">
    <PageTitle text="Browse" :subtext="filterSummary">
      <div class="flex items-center gap-2 text-sm text-stone-100/55">
        <span>{{ store.mainCount.toLocaleString() }} artists</span>
      </div>
    </PageTitle>

    <BrowseFilters />

    <BrowseArtistGrid v-if="store.viewMode === 'expanded'" />
    <BrowseListSummarized v-else />
  </div>
</template>
