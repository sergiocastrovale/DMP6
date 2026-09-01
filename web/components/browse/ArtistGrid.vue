<script setup lang="ts">
import { SearchX } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import type { Artist } from '~/types/artist'
import { grid } from '~/helpers/ui'

const store = useBrowseStore()
const { artistImage } = useImageUrl()
</script>

<template>
  <div>
    <UiLoadingBlock v-if="store.loading" />

    <UiEmptyState v-else-if="store.artists.length === 0" :icon="SearchX" message="No artists found." hint="Try a different search term or filter." />

    <div v-else :class="grid.auto">
      <Block
        v-for="artist in store.artists"
        :id="artist.id"
        :key="artist.id"
        :title="artist.name"
        :subtitle="`${artist.totalTracks.toLocaleString()} tracks`"
        :link="`/artist/${artist.slug}`"
        :image="artistImage(artist as Artist)"
        :score="(artist as Artist).averageMatchScore"
      />
    </div>

    <InfiniteScroll @load="store.loadMore()" />

    <UiLoadingBlock v-if="store.loadingMore" size="inline" />

    <div v-if="!store.loading && store.artists.length > 0" class="mt-4 text-center text-xs text-stone-100/55">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
