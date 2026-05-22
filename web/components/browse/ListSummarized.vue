<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

const handleScroll = () => {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement
  const pct = (scrollTop + clientHeight) / scrollHeight

  if (pct > 0.75) {
    store.loadMore()
  }
}

watch(() => store.loadingMore, (val, prev) => {
  if (prev && !val) {
    nextTick(() => handleScroll())
  }
})

onMounted(() => {
  window.addEventListener('scroll', handleScroll)
  nextTick(() => handleScroll())
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div>
    <div v-if="store.loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>

    <div v-else-if="store.artists.length === 0" class="py-20 text-center text-ink0">
      No artists found
    </div>

    <div v-else class="grid grid-cols-2 gap-0.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <NuxtLink
        v-for="artist in store.artists"
        :key="artist.id"
        :to="`/artist/${artist.slug}`"
        class="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-bg-1"
      >
        <div class="size-10 shrink-0 overflow-hidden rounded bg-bg-2">
          <img
            v-if="artistImage(artist)"
            :src="artistImage(artist)!"
            :alt="artist.name"
            class="size-full object-cover"
            loading="lazy"
          />
          <div v-else class="flex size-full items-center justify-center text-sm font-bold text-ink-4">
            {{ artist.name.charAt(0).toUpperCase() }}
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-ink">{{ artist.name }}</div>
          <div class="text-xs text-ink0">{{ artist.totalTracks.toLocaleString() }} tracks</div>
        </div>
      </NuxtLink>
    </div>

    <div v-if="store.loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" class="animate-spin text-ink0" />
    </div>

    <div v-if="!store.loading && store.artists.length > 0" class="mt-4 text-center text-xs text-ink0">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
