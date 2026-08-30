<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { Search, X } from 'lucide-vue-next'
import type { SearchResults } from '~/types/search'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const query = ref('')
const inputRef = ref<HTMLInputElement>()
const dropdownRef = ref<{ flatEntries: { to: string }[] } | null>(null)
const searchResults = ref<SearchResults | null>(null)
const isSearching = ref(false)
const showDropdown = ref(false)
const activeIndex = ref(-1)
const listboxId = useId()

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
    activeIndex.value = -1
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
  activeIndex.value = -1
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

const onGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    inputRef.value?.focus()
  }
}

// Arrow-key roving selection + Enter-to-navigate over the flat, cross-section entry list the
// dropdown exposes (artists, then releases, then tracks) - bound on the input itself, distinct
// from the document-level ⌘K listener above.
const onInputKeydown = (e: KeyboardEvent) => {
  if (!showDropdown.value) {
    return
  }
  const total = dropdownRef.value?.flatEntries.length ?? 0
  if (total === 0) {
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % total
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + total) % total
  }
  else if (e.key === 'Enter' && activeIndex.value >= 0) {
    e.preventDefault()
    const entry = dropdownRef.value?.flatEntries[activeIndex.value]
    if (entry) {
      const to = entry.to
      clear()
      navigateTo(to)
    }
  }
  else if (e.key === 'Escape') {
    hideDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="search-container relative w-full">
    <div class="relative">
      <Search :size="15" :stroke-width="ICON_STROKE_WIDTH" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-100/40" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showDropdown"
        :aria-controls="listboxId"
        :aria-activedescendant="activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined"
        placeholder="Search artists, releases, tracks..."
        :class="cx(
          'w-full rounded-lg border border-stone-100/10 bg-stone-900 py-2.5 pl-10 pr-3.5 text-base text-stone-100 outline-0 transition-colors duration-150',
          'placeholder:text-stone-100/30 focus:border-amber-400/45 focus:bg-stone-800',
        )"
        @focus="query && (showDropdown = true)"
        @keydown="onInputKeydown"
      >
      <button
        v-if="query"
        type="button"
        aria-label="Clear search"
        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-100/40 transition-colors duration-150 hover:text-stone-100"
        @click="clear"
      >
        <X :size="14" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
      <div
        v-else
        class="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-sm border border-stone-100/10 px-1.5 py-0.5 font-mono text-2xs text-stone-100/30"
      >
        ⌘ K
      </div>
    </div>

    <LayoutSearchDropdown
      v-if="showDropdown"
      ref="dropdownRef"
      :results="searchResults"
      :listbox-id="listboxId"
      :active-index="activeIndex"
      @select="clear"
    />
  </div>
</template>
