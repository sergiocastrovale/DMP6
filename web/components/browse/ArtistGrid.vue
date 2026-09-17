<script setup lang="ts">
import { SearchX } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import type { Artist } from '~/types/artist'
import { grid } from '~/helpers/ui'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

const hasArtists = computed(() => store.artists.length > 0)

const releaseCountText = (count: number) => `${count} ${count === 1 ? 'release' : 'releases'}`

const trackCountText = (count: number) => `${count} ${count === 1 ? 'track' : 'tracks'}`
</script>

<template>
  <div>
    <UiLoadingBlock v-if="store.loading && hasArtists" />

    <UiEmptyState v-else-if="!hasArtists" :icon="SearchX" message="No artists found." hint="Try a different search term or filter." />

    <div v-else :class="grid.auto">
      <Block
        v-for="artist in store.artists"
        :id="artist.id"
        :key="artist.id"
        :title="artist.name"
        :link="`/artist/${artist.slug}`"
        :image="artistImage(artist as Artist)"
        :completeness="(artist as Artist).completeness"
      >
        <template #subtitle>
          <span class="flex items-center gap-1.5 truncate">
            <span class="shrink-0">{{ releaseCountText(artist.releaseCount ?? 0) }}</span>
            <Bullet />
            <span class="shrink-0">{{ trackCountText(artist.totalTracks) }}</span>
          </span>
        </template>
      </Block>
    </div>

    <InfiniteScroll @load="store.loadMore()" />

    <UiLoadingBlock v-if="store.loadingMore" size="inline" />

    <div v-if="!store.loading && hasArtists" class="mt-4 text-center text-xs text-stone-100/55">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
