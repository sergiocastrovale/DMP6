<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import DialogLinks from '~/components/artist/DialogLinks.vue'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Genres from '~/components/artist/Genres.vue'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'

const props = defineProps<{
  artist: Artist
  playDisabled?: boolean
}>()

const emit = defineEmits<{
  playAll: []
}>()

const { artistImage } = useImageUrl()
const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!

const showAllGenres = ref(false)
const showAllLinks = ref(false)

const imgUrl = computed(() => artistImage(props.artist))

const statsLine = computed(() => {
  const v = catalogue.visibleCounts.value
  const t = catalogue.totalCounts.value
  const parts: string[] = []
  parts.push(`Showing ${v.total} of ${t.total} releases`)
  if (v.albums) {
    parts.push(`${v.albums} ${v.albums === 1 ? 'album' : 'albums'}`)
  }
  if (v.eps) {
    parts.push(`${v.eps} ${v.eps === 1 ? 'EP' : 'EPs'}`)
  }
  if (v.singles) {
    parts.push(`${v.singles} ${v.singles === 1 ? 'single' : 'singles'}`)
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="relative rounded-xl">
    <div class="relative flex flex-col gap-6 px-6 py-8">
      <div class="flex flex-col gap-3">
        <h1 class="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          {{ artist.name }}
        </h1>

        <div v-if="statsLine" class="text-sm text-ink-2">
          {{ statsLine }}
        </div>

        <Genres :genres="artist.genres" @more="showAllGenres = true" />

        <div>
          <button
            type="button"
            :disabled="playDisabled"
            class="mt-2 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            @click="emit('playAll')"
          >
            <Play :size="14" fill="currentColor" />
            <span>Play all</span>
          </button>
        </div>
      </div>

      <DialogGenres v-model="showAllGenres" :genres="artist.genres" />
      <DialogLinks v-model="showAllLinks" :links="artist.urls" />
    </div>

    <div class="absolute right-4 top-4">
      <slot />
    </div>
  </div>
</template>
