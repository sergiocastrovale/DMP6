<script setup lang="ts">
import { LayoutGrid, LayoutList, SlidersHorizontal, X } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import { useBrowseUrl } from '~/composables/useBrowseUrl'
import { cx, ICON_STROKE_WIDTH, layout, sw } from '~/helpers/ui'

const BROWSE_VIEW_OPTIONS = [
  { value: 'expanded', icon: LayoutGrid, title: 'Grid view' },
  { value: 'summarized', icon: LayoutList, title: 'List view' },
]

const store = useBrowseStore()
const { initFromUrl } = useBrowseUrl()

const searchInput = ref(store.searchQuery)
const sidebarOpen = ref(false)

const viewMode = computed({
  get: () => store.viewMode,
  set: (val: string) => store.setViewMode(val as 'expanded' | 'summarized'),
})

const handleSearch = (value: string) => {
  searchInput.value = value
  store.setSearch(value)
}

const handleLetterSelect = (letter: string | null) => {
  searchInput.value = ''
  store.setLetterFilter(letter)
}

onMounted(() => {
  const hasParams = initFromUrl()
  if (hasParams) {
    searchInput.value = store.searchQuery
  }
  if (hasParams || store.artists.length === 0) {
    store.fetchArtists()
  }
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <SearchInput
        :model-value="searchInput"
        placeholder="Filter artists..."
        :debounce="300"
        wrapper-class="basis-full lg:basis-auto lg:flex-1 lg:max-w-xs"
        @update:model-value="handleSearch"
      />
      <button type="button" :class="cx(sw('chip', store.activeFilterCount > 0), 'gap-2')" @click="sidebarOpen = true">
        <SlidersHorizontal :size="14" :stroke-width="ICON_STROKE_WIDTH" />
        Filters
        <span v-if="store.activeFilterCount" :class="sw('countPill', true)">{{ store.activeFilterCount }}</span>
      </button>
      <button v-if="store.activeFilterCount" type="button" :class="cx(sw('chip', false), 'gap-1')" @click="store.clearFilters">
        <X :size="14" :stroke-width="ICON_STROKE_WIDTH" />
        Clear filters
      </button>
      <div :class="layout.spacer" />
      <ArtistListToggle v-model="viewMode" :options="BROWSE_VIEW_OPTIONS" />
    </div>

    <BrowseFilterLetter :active="store.letterFilter" @select="handleLetterSelect" />

    <BrowseFiltersSidebar v-model="sidebarOpen" />
  </div>
</template>
