<script setup lang="ts">
import { Loader2, SearchX } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const store = useBrowseStore()
const { artistImage } = useImageUrl()
</script>

<template>
  <div>
    <div v-if="store.loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/40" />
    </div>

    <UiEmptyState v-else-if="store.artists.length === 0" :icon="SearchX" message="No artists found." hint="Try a different search term or filter." />

    <div v-else class="grid grid-cols-2 gap-0.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <NuxtLink
        v-for="artist in store.artists"
        :key="artist.id"
        :to="`/artist/${artist.slug}`"
        class="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-stone-900"
      >
        <div class="size-10 shrink-0 overflow-hidden rounded-md bg-stone-800">
          <img
            v-if="artistImage(artist)"
            :src="artistImage(artist)!"
            :alt="artist.name"
            class="size-full object-cover"
            loading="lazy"
          >
          <div v-else class="flex size-full items-center justify-center text-sm font-bold text-stone-100/30">
            {{ artist.name.charAt(0).toUpperCase() }}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-stone-100">{{ artist.name }}</div>
          <div class="text-xs text-stone-100/40">{{ artist.totalTracks.toLocaleString() }} tracks</div>
        </div>
      </NuxtLink>
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
