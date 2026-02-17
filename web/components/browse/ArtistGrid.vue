<script setup lang="ts">
import { useBrowseStore } from '~/stores/browse'
import { Loader2 } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'

const store = useBrowseStore()

const scrollContainer = ref<HTMLElement>()

function handleScroll() {
  if (!scrollContainer.value) { 
    return
  }

  const { scrollTop, scrollHeight, clientHeight } = document.documentElement
  const pct = (scrollTop + clientHeight) / scrollHeight
  
  if (pct > 0.75) {
    store.loadMore()
  }
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div>
    <div v-if="store.loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <div v-else-if="store.artists.length === 0" class="py-20 text-center text-zinc-500">
      No artists found
    </div>

    <div v-else ref="scrollContainer" class="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      <BrowseArtistCard
        v-for="artist in store.artists"
        :key="artist.id"
        :artist="artist as Artist"
      />
    </div>

    <div v-if="store.loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" class="animate-spin text-zinc-500" />
    </div>

    <div v-if="!store.loading && store.artists.length > 0" class="mt-4 text-center text-xs text-zinc-500">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
