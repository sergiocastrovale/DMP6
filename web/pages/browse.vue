<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import { browseFilterSummary } from '~/helpers/browseFilterSummary'
import { layout } from '~/helpers/ui'

useTitle('Browse')

const store = useBrowseStore()
const { hasPerm } = useAuth()
const canAddArtist = hasPerm('sync.run')

// Sort is always shown (it always has a value); genre/completeness only join in once set.
const filterSummary = computed(() => browseFilterSummary(store))
</script>

<template>
  <div :class="layout.page">
    <PageTitle text="Browse" :subtext="filterSummary">
      <UiButton v-if="canAddArtist" to="/add" size="md" :icon="Plus">
        Add artist
      </UiButton>
    </PageTitle>

    <BrowseFilters />

    <BrowseArtistGrid v-if="store.viewMode === 'expanded'" />
    <BrowseListSummarized v-else />
  </div>
</template>
