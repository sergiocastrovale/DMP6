<script setup lang="ts">
import type { SearchCounts } from '~/types/search'
import type { TabItem } from '~/types/ui'
import { layout, cx } from '~/helpers/ui'

const route = useRoute()
const query = computed(() => (route.query.q as string) || '')

const counts = ref<SearchCounts>({ artists: 0, releases: 0, tracks: 0 })

// Each tab's own content component fetches its own page independently via SearchResultsList;
// this fetch only needs the counts, for the tab badges.
const fetchCounts = async () => {
  if (query.value.length < 2) {
    counts.value = { artists: 0, releases: 0, tracks: 0 }
    return
  }
  const data = await $fetch<{ counts: SearchCounts }>('/api/search', { params: { q: query.value } })
  counts.value = data.counts
}

watch(query, fetchCounts, { immediate: true })

const tabs = computed<TabItem[]>(() => [
  { key: 'artists', label: 'Artists', href: `/search/artists?q=${encodeURIComponent(query.value)}`, count: counts.value.artists },
  { key: 'releases', label: 'Releases', href: `/search/releases?q=${encodeURIComponent(query.value)}`, count: counts.value.releases },
  { key: 'tracks', label: 'Tracks', href: `/search/tracks?q=${encodeURIComponent(query.value)}`, count: counts.value.tracks },
])
</script>

<template>
  <TabShell :tabs="tabs">
    <template #header>
      <div :class="cx(layout.page)">
        <PageTitle :text="query ? `Search results for “${query}”` : 'Search'" />
      </div>
    </template>

    <slot />
  </TabShell>
</template>
