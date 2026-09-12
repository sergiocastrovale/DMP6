<script setup lang="ts">
import type { Component } from 'vue'
import SearchArtistsContent from '~/components/search/ArtistsContent.vue'
import SearchReleasesContent from '~/components/search/ReleasesContent.vue'
import SearchTracksContent from '~/components/search/TracksContent.vue'

const TABS: Record<string, { title: string; component: Component }> = {
  artists: { title: 'Artists', component: SearchArtistsContent },
  releases: { title: 'Releases', component: SearchReleasesContent },
  tracks: { title: 'Tracks', component: SearchTracksContent },
}

definePageMeta({
  validate: route => (route.params.tab as string) in TABS,
})

const route = useRoute()
const tab = TABS[route.params.tab as string]!
const query = computed(() => (route.query.q as string) || '')
useTitle('Search', tab.title)
</script>

<template>
  <SearchShell>
    <component :is="tab.component" :query="query" />
  </SearchShell>
</template>
