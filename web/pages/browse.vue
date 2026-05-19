<script setup lang="ts">
import { LayoutGrid, LayoutList, Search } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import RelatedArtistsPopover from '~/components/browse/RelatedArtistsPopover.vue'

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

let searchTimeout: ReturnType<typeof setTimeout>

function handleSearch(value: string) {
  searchInput.value = value
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    store.setSearch(value)
  }, 300)
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

onBeforeUnmount(() => {
  clearTimeout(searchTimeout)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageTitle text="Browse">
      <div class="flex items-center gap-2 text-sm text-zinc-500">
        <span>{{ store.mainCount.toLocaleString() }} artists</span>
        <span class="text-zinc-700">|</span>
        <span>{{ store.relatedCount.toLocaleString() }} related artists</span>
        <RelatedArtistsPopover />
      </div>
    </PageTitle>

    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 sm:max-w-xs">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          :value="searchInput"
          type="text"
          placeholder="Filter artists..."
          class="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-8 pr-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          @input="handleSearch(($event.target as HTMLInputElement).value)"
        />
      </div>
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
