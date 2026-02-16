<script setup lang="ts">
import { Search, SlidersHorizontal } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const showAdvanced = ref(false)
const searchInput = ref('')

let searchTimeout: ReturnType<typeof setTimeout>

function handleSearch(value: string) {
  searchInput.value = value
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    store.setSearch(value)
  }, 300)
}

onMounted(() => {
  if (store.artists.length === 0) {
    store.fetchArtists()
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-zinc-50">Browse</h1>
      <span class="text-sm text-zinc-500">{{ store.total.toLocaleString() }} artists</span>
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
      <button
        class="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-50"
        :class="{ 'border-amber-500 text-amber-400': showAdvanced }"
        @click="showAdvanced = !showAdvanced"
      >
        <SlidersHorizontal :size="12" />
        Filters
      </button>
    </div>

    <!-- Letter filter -->
    <BrowseFilterLetter :active="store.letterFilter" @select="store.setLetterFilter" />

    <!-- Artist grid -->
    <BrowseArtistGrid />
  </div>
</template>
