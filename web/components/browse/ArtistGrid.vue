<script setup lang="ts">
import { useBrowseStore } from '~/stores/browse'
import { Loader2 } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

</script>

<template>
  <div>
    <div v-if="store.loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>

    <div v-else-if="store.artists.length === 0" class="py-20 text-center text-ink0">
      No artists found
    </div>

    <div v-else ref="scrollContainer" class="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(130px,200px))] xl:grid-cols-[repeat(auto-fill,minmax(130px,220px))]">
      <Block
        v-for="artist in store.artists"
        :key="artist.id"
        :id="artist.id"
        :title="artist.name"
        :subtitle="`${artist.totalTracks.toLocaleString()} tracks`"
        :link="`/artist/${artist.slug}`"
        :image="artistImage(artist as Artist)"
        :score="(artist as Artist).averageMatchScore"
      />
    </div>

    <InfiniteScroll @load="store.loadMore()" />

    <div v-if="store.loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" class="animate-spin text-ink0" />
    </div>

    <div v-if="!store.loading && store.artists.length > 0" class="mt-4 text-center text-xs text-ink0">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
