<template>
  <div
    v-if="results && hasResults"
    class="absolute left-0 right-0 top-full z-50 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
  >
    <div v-if="results.artists.length > 0" class="border-b border-zinc-800 p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-zinc-500">
        Artists
      </div>
      <NuxtLink
        v-for="artist in results.artists"
        :key="artist.id"
        :to="`/artist/${artist.slug}`"
        class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-800 transition-colors"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
          <img
            v-if="artistImageUrl(artist)"
            :src="artistImageUrl(artist)!"
            :alt="artist.name"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
            <LucideUser class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-zinc-50">
            {{ artist.name }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <div v-if="results.releases.length > 0" class="border-b border-zinc-800 p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-zinc-500">
        Releases
      </div>
      <button
        v-for="release in results.releases"
        :key="release.id"
        class="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-800 transition-colors text-left"
        @click="playRelease(release.id)"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
          <img
            v-if="releaseImageUrl(release)"
            :src="releaseImageUrl(release)!"
            :alt="release.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
            <LucideDisc class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-zinc-50">
            {{ release.title }}
          </p>
          <p v-if="release.artist" class="truncate text-xs text-zinc-400">
            {{ release.artist.name }}
            <span v-if="release.year" class="text-zinc-600">• {{ release.year }}</span>
          </p>
        </div>
      </button>
    </div>

    <div v-if="results.tracks.length > 0" class="p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-zinc-500">
        Tracks
      </div>
      <button
        v-for="track in results.tracks"
        :key="track.id"
        class="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-800 transition-colors text-left"
        @click="playTrack(track)"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
          <img
            v-if="track.release && releaseImageUrl(track.release)"
            :src="releaseImageUrl(track.release)!"
            :alt="track.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
            <LucideMusic class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-zinc-50">
            {{ track.title }}
          </p>
          <p v-if="track.release?.artist" class="truncate text-xs text-zinc-400">
            {{ track.release.artist.name }}
            <span v-if="track.release.title" class="text-zinc-600">• {{ track.release.title }}</span>
          </p>
        </div>
        <span v-if="track.duration" class="text-xs text-zinc-500">
          {{ formatDuration(track.duration) }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LucideUser, LucideDisc, LucideMusic } from 'lucide-vue-next'
import type { SearchResults, SearchTrack } from '~/types/search'
import { formatDuration } from '~/helpers/functions'

interface Props {
  results: SearchResults | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: []
}>()

const { artistImage, releaseImage } = useImageUrl()
const playerStore = usePlayerStore()
const { playRelease: playReleaseById } = usePlayRelease()

const hasResults = computed(() => {
  if (!props.results)
    return false
  return props.results.artists.length > 0
    || props.results.releases.length > 0
    || props.results.tracks.length > 0
})

function artistImageUrl(artist: any) {
  return artistImage(artist)
}

function releaseImageUrl(release: any) {
  return releaseImage(release)
}


const playRelease = async (releaseId: string) => {
  await playReleaseById(releaseId)
  emit('select')
}

const playTrack = (track: SearchTrack) => {
  playerStore.setQueue([{
    id: track.id,
    title: track.title || 'Unknown',
    artist: track.release?.artist?.name || 'Unknown',
    album: track.release?.title || 'Unknown',
    duration: track.duration || 0,
    artistSlug: track.release?.artist?.slug || null,
    releaseImage: track.release?.image || null,
    releaseImageUrl: track.release?.imageUrl || null,
    localReleaseId: track.release?.id || null,
  }])
  emit('select')
}
</script>
