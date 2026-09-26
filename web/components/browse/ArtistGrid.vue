<script setup lang="ts">
import { SearchX } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import type { Artist } from '~/types/artist'
import { grid } from '~/helpers/ui'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

const gridEl = ref<HTMLElement | null>(null)
const artistCount = computed(() => store.artists.length)
const { windowed, start, end, padTop, padBottom } = useWindowedGrid(artistCount, gridEl)

const hasArtists = computed(() => store.artists.length > 0)

// A long browse session keeps thousands of artists in the store; only the rows near the viewport are in the DOM.
const visibleArtists = computed(() => windowed.value ? store.artists.slice(start.value, end.value) : store.artists)
const gridStyle = computed(() => windowed.value ? { paddingTop: `${padTop.value}px`, paddingBottom: `${padBottom.value}px` } : undefined)

const releaseCountText = (count: number) => `${count} ${count === 1 ? 'release' : 'releases'}`

const trackCountText = (count: number) => `${count} ${count === 1 ? 'track' : 'tracks'}`
</script>

<template>
  <div>
    <UiLoadingBlock v-if="store.loading && hasArtists" />

    <UiEmptyState v-else-if="!hasArtists" :icon="SearchX" message="No artists found." hint="Try a different search term or filter." />

    <div v-else ref="gridEl" :class="grid.auto" :style="gridStyle">
      <Block
        v-for="artist in visibleArtists"
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
