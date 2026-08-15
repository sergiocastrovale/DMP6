<script setup lang="ts">
import { LayoutGrid, LayoutList } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const { initFromUrl } = useBrowseUrl()
const searchInput = ref(store.searchQuery)

const BROWSE_VIEW_OPTIONS = [
  { value: 'expanded', icon: LayoutGrid, title: 'Grid view' },
  { value: 'summarized', icon: LayoutList, title: 'List view' },
]

const browseViewMode = computed({
  get: () => store.viewMode,
  set: (val: string) => store.setViewMode(val as 'expanded' | 'summarized'),
})

const handleSearch = (value: string) => {
  searchInput.value = value
  store.setSearch(value)
}

function handleLetterSelect(letter: string | null) {
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
  <div class="flex flex-col gap-4">
    <PageTitle text="Browse">
      <div class="flex items-center gap-2 text-sm text-ink-3">
        <span>{{ store.mainCount.toLocaleString() }} artists</span>
      </div>
    </PageTitle>

    <div class="flex flex-wrap items-center gap-3">
      <SearchInput
        :model-value="searchInput"
        placeholder="Filter artists..."
        :debounce="300"
        wrapper-class="flex-1 sm:max-w-xs"
        @update:model-value="handleSearch"
      />
      <BrowseFilterSort :active="store.sortBy" @select="store.setSortBy" />
      <BrowseFilterGenre :active="store.genreFilter" @select="store.setGenreFilter" />
      <BrowseFilterScore
        :min-score="store.minScore"
        :max-score="store.maxScore"
        @update:range="store.setScoreRange"
      />
      <div class="flex-1" />
      <ArtistListToggle v-model="browseViewMode" :options="BROWSE_VIEW_OPTIONS" />
    </div>

    <BrowseFilterLetter :active="store.letterFilter" @select="handleLetterSelect" />
    
    <BrowseArtistGrid v-if="browseViewMode === 'expanded'" />
    <BrowseListSummarized v-else />
  </div>
</template>
