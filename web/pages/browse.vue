<script setup lang="ts">
import { Search, HelpCircle } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const searchInput = ref(store.searchQuery)

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
  if (store.artists.length === 0) {
    store.fetchArtists()
  }
})

onBeforeUnmount(() => {
  clearTimeout(searchTimeout)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-zinc-50">Browse</h1>
      <div class="flex items-center gap-2 text-sm text-zinc-500">
        <span>{{ store.mainCount.toLocaleString() }} artists</span>
        <span class="text-zinc-700">|</span>
        <span>{{ store.relatedCount.toLocaleString() }} related artists</span>
        <Popover trigger="hover">
          <template #trigger>
            <button class="text-zinc-500 transition-colors hover:text-zinc-300">
              <HelpCircle :size="14" />
            </button>
          </template>
          <template #content>
            <div class="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl">
              <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Artists vs related artists
              </p>
              <p class="mb-2 text-xs text-zinc-300">
                <span class="font-medium text-zinc-50">Artists</span> are the ones you have audio files for — each has its own folder under your music directory.
              </p>
              <p class="text-xs text-zinc-300">
                <span class="font-medium text-zinc-50">Related artists</span> were pulled in by the sync because they collaborate on a release owned by another artist (e.g. featured artists, or splits from compound names like "A &amp; B").
              </p>
            </div>
          </template>
        </Popover>
      </div>
    </div>

    <!-- Search + controls -->
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
        @update:min-score="store.setMinScore"
        @update:max-score="store.setMaxScore"
      />
    </div>

    <!-- Letter filter -->
    <BrowseFilterLetter :active="store.letterFilter" @select="handleLetterSelect" />

    <!-- Artist grid -->
    <BrowseArtistGrid />
  </div>
</template>
