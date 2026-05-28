<template>
  <div
    v-if="results && hasResults"
    class="absolute left-0 right-0 top-full z-50 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-rule bg-bg-2 shadow-xl"
  >
    <div v-if="results.artists.length > 0" class="border-b border-rule p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-ink-3">
        Artists
      </div>
      <NuxtLink
        v-for="artist in results.artists"
        :key="artist.id"
        :to="`/artist/${artist.slug}`"
        class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-3 transition-colors"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-bg-3">
          <img
            v-if="artistImageUrl(artist)"
            :src="artistImageUrl(artist)!"
            :alt="artist.name"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
            <LucideUser class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-ink">
            {{ artist.name }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <div v-if="results.releases.length > 0" class="border-b border-rule p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-ink-3">
        Releases
      </div>
      <NuxtLink
        v-for="release in results.releases"
        :key="release.id"
        :to="release.artist ? `/artist/${release.artist.slug}?releaseId=${release.id}` : '#'"
        class="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-3 transition-colors text-left"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-bg-3">
          <img
            v-if="releaseImageUrl(release)"
            :src="releaseImageUrl(release)!"
            :alt="release.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
            <LucideDisc class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-ink">
            {{ release.title }}
          </p>
          <p v-if="release.artist" class="truncate text-xs text-ink-2">
            {{ release.artist.name }}
            <span v-if="release.year" class="text-ink-4">• {{ release.year }}</span>
          </p>
        </div>
      </NuxtLink>
    </div>

    <div v-if="results.tracks.length > 0" class="p-2">
      <div class="px-2 py-1 text-xs font-semibold uppercase text-ink-3">
        Tracks
      </div>
      <NuxtLink
        v-for="track in results.tracks"
        :key="track.id"
        :to="track.release?.artist ? `/artist/${track.release.artist.slug}?releaseId=${track.release.id}&trackId=${track.id}` : '#'"
        class="flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg-3 transition-colors text-left"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded bg-bg-3">
          <img
            v-if="track.release && releaseImageUrl(track.release)"
            :src="releaseImageUrl(track.release)!"
            :alt="track.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
            <LucideMusic class="size-5" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-sm font-medium text-ink">
            {{ track.title }}
          </p>
          <p v-if="track.release?.artist" class="truncate text-xs text-ink-2">
            {{ track.release.artist.name }}
            <span v-if="track.release.title" class="text-ink-4">• {{ track.release.title }}</span>
          </p>
        </div>
        <span v-if="track.duration" class="text-xs text-ink-3">
          {{ formatDuration(track.duration) }}
        </span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LucideUser, LucideDisc, LucideMusic } from 'lucide-vue-next'
import type { SearchResults } from '~/types/search'
import { formatDuration } from '~/helpers/functions'

interface Props {
  results: SearchResults | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: []
}>()

const { artistImage, releaseImage } = useImageUrl()

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
</script>
