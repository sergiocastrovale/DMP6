<script setup lang="ts">
import { Download, LayoutGrid, LayoutList, ListFilter } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/types/ui'

defineProps<{
  downloadOptions: ButtonDropdownOption[]
  showDownload: boolean
}>()

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

const sortOpen = ref(false)
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

    <ButtonDropdown
      v-if="showDownload"
      label="Download missing"
      :options="downloadOptions"
    >
      <template #icon>
        <Download :size="14" />
      </template>
    </ButtonDropdown>

    <div class="flex-1" />

    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-rule bg-bg-1 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:text-ink"
        @click="sortOpen = !sortOpen"
      >
        <ListFilter :size="12" />
        <span>Sort</span>
      </button>
      <div
        v-if="sortOpen"
        class="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-rule bg-bg-1 p-1 shadow-xl"
      >
        <button
          v-for="opt in SORT_OPTIONS"
          :key="opt.value"
          type="button"
          class="flex w-full items-center rounded px-3 py-2 text-left text-xs transition-colors"
          :class="sortKey === opt.value ? 'bg-bg-2 text-ink' : 'text-ink-2 hover:bg-bg-2 hover:text-ink'"
          @click="sortKey = opt.value; sortOpen = false"
        >
          {{ opt.label }}
        </button>
      </div>
      <div v-if="sortOpen" class="fixed inset-0 z-10" @click="sortOpen = false" />
    </div>

    <ArtistListToggle v-model="viewMode" :options="VIEW_OPTIONS" />
  </div>
</template>
