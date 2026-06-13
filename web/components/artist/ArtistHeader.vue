<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import DialogLinks from '~/components/artist/DialogLinks.vue'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Genres from '~/components/artist/Genres.vue'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'
import type { ReleaseProgress } from '~/types/download'

const props = defineProps<{
  artist: Artist
  playDisabled?: boolean
  activeDownloads?: ReleaseProgress[]
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

        <DownloadProgress v-if="activeDownloads?.length" :items="activeDownloads" class="max-w-md" />

        <Genres :genres="artist.genres" @more="showAllGenres = true" />

        <div>
          <UiButton class="mt-2" :icon="Play" icon-class="fill-current" :disabled="playDisabled" @click="emit('playAll')">
            Play all
          </UiButton>
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
