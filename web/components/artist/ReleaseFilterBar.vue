<script setup lang="ts">
import { LayoutGrid, LayoutList } from 'lucide-vue-next'
import { layout } from '~/helpers/ui'

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!
const { searchQuery, statusCounts, activeFilterCount, clearFilters } = catalogue

const viewMode = defineModel<'catalogue' | 'list'>('viewMode', { default: 'catalogue' })

const VIEW_OPTIONS = [
  { value: 'catalogue', icon: LayoutGrid, title: 'Catalogue view' },
  { value: 'list', icon: LayoutList, title: 'List view' },
]

const sidebarOpen = ref(false)
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <ArtistReleaseSearch v-model="searchQuery" placeholder="Search releases..." />

    <UiFilterButton v-model:open="sidebarOpen" :active-count="activeFilterCount" @clear="clearFilters" />

    <div :class="layout.spacer" />

    <ArtistListToggle v-model="viewMode" :options="VIEW_OPTIONS" />

    <ArtistFiltersSidebar v-model="sidebarOpen" :status-counts="statusCounts" />
  </div>
</template>
