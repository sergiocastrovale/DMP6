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

const clear = () => {
  query.value = ''
  searchResults.value = null
  showDropdown.value = false
  inputRef.value?.focus()
}

const hideDropdown = () => {
  showDropdown.value = false
}

const onClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.search-container')) {
    hideDropdown()
  }
}

const onKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    inputRef.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="search-container relative w-full">
    <div class="relative">
      <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="Search artists, releases, tracks..."
        class="w-full bg-bg-2 border border-rule rounded-lg py-2.5 px-3.5 pl-10 text-ink text-sm placeholder:text-ink-4 outline-none transition focus:bg-bg-1 focus:border-accent focus:shadow-ring-accent"
        @focus="query && (showDropdown = true)"
      />
      <button
        v-if="query"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
        aria-label="Clear search"
        @click="clear"
      >
        <X :size="14" />
      </button>
      <div
        v-else
        class="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 font-mono text-[10px] text-ink-4 border border-rule px-1.5 py-0.5 rounded pointer-events-none"
      >
        ⌘ K
      </div>
    </div>

    <LayoutSearchDropdown
      v-if="showDropdown"
      :results="searchResults"
      @select="clear"
    />
  </div>
</template>
