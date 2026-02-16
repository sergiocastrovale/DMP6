<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { Search, X } from 'lucide-vue-next'
import type { SearchResults } from '~/types/search'

const query = ref('')
const inputRef = ref<HTMLInputElement>()
const searchResults = ref<SearchResults | null>(null)
const isSearching = ref(false)
const showDropdown = ref(false)

const performSearch = useDebounceFn(async (searchQuery: string) => {
  if (!searchQuery || searchQuery.length < 2) {
    searchResults.value = null
    showDropdown.value = false
    return
  }

  isSearching.value = true
  try {
    const data = await $fetch<SearchResults>(`/api/search?q=${encodeURIComponent(searchQuery)}`)
    searchResults.value = data
    showDropdown.value = true
  }
  catch (error) {
    console.error('Search failed:', error)
    searchResults.value = null
  }
  finally {
    isSearching.value = false
  }
}, 300)

watch(query, (newQuery) => {
  performSearch(newQuery)
})

function clear() {
  query.value = ''
  searchResults.value = null
  showDropdown.value = false
  inputRef.value?.focus()
}

function hideDropdown() {
  showDropdown.value = false
}

// Close dropdown when clicking outside
onMounted(() => {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.search-container')) {
      hideDropdown()
    }
  })
})
</script>

<template>
  <div class="search-container relative w-full max-w-md">
    <div class="relative">
      <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Search artists, releases, tracks..."
        class="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-9 pr-8 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        @focus="query && (showDropdown = true)"
      />
      <button
        v-if="query"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        @click="clear"
      >
        <X :size="14" />
      </button>
    </div>

    <!-- Search dropdown -->
    <LayoutSearchDropdown
      v-if="showDropdown"
      :results="searchResults"
      @select="clear"
    />
  </div>
</template>
