<script setup lang="ts">
import { LayoutGrid, LayoutList, ListFilter } from 'lucide-vue-next'

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!
const { searchQuery, typeFilter, showMissing, showLinked, sortKey, hasLinkedReleases } = catalogue

const viewMode = defineModel<'catalogue' | 'list'>('viewMode', { default: 'catalogue' })

const TYPE_OPTIONS = [
  { value: 'album', label: 'Albums' },
  { value: 'ep', label: 'EPs' },
  { value: 'single', label: 'Singles' },
  { value: 'other', label: 'Other' },
]

const SORT_OPTIONS = [
  { value: 'year-asc', label: 'Year (oldest first)' },
  { value: 'year-desc', label: 'Year (newest first)' },
  { value: 'title', label: 'Title' },
  { value: 'tracks-desc', label: 'Most tracks' },
  { value: 'plays-desc', label: 'Most played' },
] as const

const VIEW_OPTIONS = [
  { value: 'catalogue', icon: LayoutGrid, title: 'Catalogue view' },
  { value: 'list', icon: LayoutList, title: 'List view' },
]

// Sort always has exactly one active value - never null - so update:modelValue's value is never
// actually null here despite Dropdown's nullable contract (see allow-clear="false" below).
const onSortSelect = (value: string | null) => {
  if (value) {
    sortKey.value = value
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <ArtistReleaseSearch v-model="searchQuery" placeholder="Search releases..." />

    <Dropdown
      v-model="typeFilter"
      :options="TYPE_OPTIONS"
      placeholder="All releases"
    />

    <Switch v-model="showMissing" label="Show missing" />
    <Switch v-if="hasLinkedReleases" v-model="showLinked" label="Show linked" />

    <div class="flex-1" />

    <Dropdown
      :model-value="sortKey"
      :options="[...SORT_OPTIONS]"
      :icon="ListFilter"
      :allow-clear="false"
      @update:model-value="onSortSelect"
    />

    <ArtistListToggle v-model="viewMode" :options="VIEW_OPTIONS" />
  </div>
</template>
