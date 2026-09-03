<script setup lang="ts">
import { Play, Shuffle } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Genres from '~/components/artist/Genres.vue'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'
import type { ReleaseProgress } from '~/types/download'
import { typography } from '~/helpers/ui'
import { useImageUrl } from '~/composables/useImageUrl'

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

const { artistImage } = useImageUrl()
const image = computed(() => artistImage(props.artist))

const showAllGenres = ref(false)
</script>

<template>
  <div class="relative overflow-hidden">
    <ArtistImage :artist="artist" type="mobile" />

    <div class="relative flex flex-col gap-3 p-3">
      <h1 :class="typography.h1">
        {{ artist.name }}
      </h1>

      <ArtistShowing />

      <DownloadProgress v-if="activeDownloads?.length" :items="activeDownloads" class="max-w-md" />

      <Genres :genres="artist.genres" @more="showAllGenres = true" />

      <div class="mt-2 flex items-center gap-2">
        <UiButton :icon="Play" icon-class="fill-current" :disabled="playDisabled" @click="emit('playAll')">
          Play all
        </UiButton>
        <UiButton variant="secondary" :icon="Shuffle" :disabled="shuffleDisabled" @click="emit('shuffleAll')">
          Shuffle
        </UiButton>
      </div>

      <div class="mt-1 flex items-center gap-2">
        <slot />
      </div>
    </div>

    <DialogGenres v-model="showAllGenres" :genres="artist.genres" />
  </div>
</template>
