<script setup lang="ts">
import { Play, Shuffle } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Genres from '~/components/artist/Genres.vue'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'
import type { ReleaseProgress } from '~/types/download'
import { typography } from '~/helpers/ui'

const props = defineProps<{
  artist: Artist
  playDisabled?: boolean
  shuffleDisabled?: boolean
  activeDownloads?: ReleaseProgress[]
}>()

const emit = defineEmits<{
  playAll: []
  shuffleAll: []
}>()

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!
const { artistImage } = useImageUrl()

const showAllGenres = ref(false)

const image = computed(() => artistImage(props.artist))

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
    <div class="relative flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-start sm:gap-6">
      <div class="size-28 shrink-0 overflow-hidden rounded-xl border border-stone-100/6 bg-stone-800 sm:size-36">
        <img
          v-if="image"
          :src="image"
          :alt="artist.name"
          class="size-full object-cover"
        >
        <div v-else class="flex size-full items-center justify-center font-display text-4xl font-bold text-stone-100/20">
          {{ artist.name.charAt(0).toUpperCase() }}
        </div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <h1 :class="typography.h1">
          {{ artist.name }}
        </h1>

        <div v-if="statsLine" class="text-base text-stone-100/60">
          {{ statsLine }}
        </div>

        <DownloadProgress v-if="activeDownloads?.length" :items="activeDownloads" class="max-w-md" />

        <Genres :genres="artist.genres" @more="showAllGenres = true" />

        <div class="mt-2 flex items-center gap-2">
          <UiButton :icon="Play" icon-class="fill-current" :disabled="playDisabled" @click="emit('playAll')">
            Play all
          </UiButton>
          <!-- One primary action per view (handoff/RULES.md): Play all is it, Shuffle is the
               alternative route into the same queue. -->
          <UiButton variant="secondary" :icon="Shuffle" :disabled="shuffleDisabled" @click="emit('shuffleAll')">
            Shuffle
          </UiButton>
        </div>
      </div>

      <DialogGenres v-model="showAllGenres" :genres="artist.genres" />
    </div>

    <div class="absolute right-4 top-4">
      <slot />
    </div>
  </div>
</template>
