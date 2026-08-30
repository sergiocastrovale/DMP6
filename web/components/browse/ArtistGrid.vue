<script setup lang="ts">
import { Loader2, SearchX } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import type { Artist } from '~/types/artist'
import { grid, ICON_STROKE_WIDTH } from '~/helpers/ui'

const store = useBrowseStore()
const { artistImage } = useImageUrl()
</script>

<template>
  <div>
    <div v-if="store.loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/40" />
    </div>

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

    <div v-if="store.loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/40" />
    </div>

    <div v-if="!store.loading && store.artists.length > 0" class="mt-4 text-center text-xs text-stone-100/40">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
