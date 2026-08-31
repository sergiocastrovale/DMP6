<script setup lang="ts">
import { Disc, Music, User } from 'lucide-vue-next'
import type { SearchResults } from '~/types/search'
import { formatDuration } from '~/helpers/functions'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

interface Props {
  results: SearchResults | null
  listboxId?: string
  activeIndex?: number
}

const props = withDefaults(defineProps<Props>(), {
  listboxId: undefined,
  activeIndex: -1,
})
const emit = defineEmits<{
  select: []
}>()

const { artistImage, releaseImage } = useImageUrl()

const hasResults = computed(() => {
  if (!props.results) {
    return false
  }
  return props.results.artists.length > 0
    || props.results.releases.length > 0
    || props.results.tracks.length > 0
})

// One flat, ordered list backing both the roving arrow-key highlight (SearchBar owns the index,
// this is what it counts against and reads a route from on Enter) and the per-item aria-selected
// state below - artists, then releases, then tracks, matching render order.
const flatEntries = computed(() => {
  const entries: { to: string }[] = []
  if (props.results) {
    for (const artist of props.results.artists) {
      entries.push({ to: `/artist/${artist.slug}` })
    }
    for (const release of props.results.releases) {
      entries.push({ to: release.artist ? `/artist/${release.artist.slug}?releaseId=${release.id}` : '#' })
    }
    for (const track of props.results.tracks) {
      entries.push({ to: track.release?.artist ? `/artist/${track.release.artist.slug}?releaseId=${track.release.id}&trackId=${track.id}` : '#' })
    }
  }
  return entries
})

const artistOffset = 0
const releaseOffset = computed(() => props.results?.artists.length ?? 0)
const trackOffset = computed(() => releaseOffset.value + (props.results?.releases.length ?? 0))

defineExpose({ flatEntries })

const optionClass = (index: number) => cx(
  'flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150',
  index === props.activeIndex ? 'bg-stone-800' : 'hover:bg-stone-800',
)
</script>

<template>
  <div
    v-if="results && hasResults"
    :id="listboxId"
    role="listbox"
    class="absolute left-0 right-0 top-full z-50 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-stone-100/10 bg-stone-900 shadow-lg"
  >
    <div v-if="results.artists.length > 0" class="border-b border-stone-100/6 p-2">
      <div class="px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">
        Artists
      </div>
      <NuxtLink
        v-for="(artist, i) in results.artists"
        :id="`${listboxId}-option-${artistOffset + i}`"
        :key="artist.id"
        role="option"
        :aria-selected="artistOffset + i === activeIndex"
        :to="`/artist/${artist.slug}`"
        :class="optionClass(artistOffset + i)"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded-md bg-stone-800">
          <img
            v-if="artistImage(artist)"
            :src="artistImage(artist)!"
            :alt="artist.name"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-stone-100/50">
            <User :size="18" :stroke-width="ICON_STROKE_WIDTH" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-base font-medium text-stone-100">
            {{ artist.name }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <div v-if="results.releases.length > 0" class="border-b border-stone-100/6 p-2">
      <div class="px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">
        Releases
      </div>
      <NuxtLink
        v-for="(release, i) in results.releases"
        :id="`${listboxId}-option-${releaseOffset + i}`"
        :key="release.id"
        role="option"
        :aria-selected="releaseOffset + i === activeIndex"
        :to="release.artist ? `/artist/${release.artist.slug}?releaseId=${release.id}` : '#'"
        :class="cx(optionClass(releaseOffset + i), 'text-left w-full')"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded-md bg-stone-800">
          <img
            v-if="releaseImage(release)"
            :src="releaseImage(release)!"
            :alt="release.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-stone-100/50">
            <Disc :size="18" :stroke-width="ICON_STROKE_WIDTH" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-base font-medium text-stone-100">
            {{ release.title }}
          </p>
          <p v-if="release.artist" class="truncate text-xs text-stone-100/60">
            {{ release.artist.name }}
            <span v-if="release.year" class="text-stone-100/50">· {{ release.year }}</span>
          </p>
        </div>
      </NuxtLink>
    </div>

    <div v-if="results.tracks.length > 0" class="p-2">
      <div class="px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">
        Tracks
      </div>
      <NuxtLink
        v-for="(track, i) in results.tracks"
        :id="`${listboxId}-option-${trackOffset + i}`"
        :key="track.id"
        role="option"
        :aria-selected="trackOffset + i === activeIndex"
        :to="track.release?.artist ? `/artist/${track.release.artist.slug}?releaseId=${track.release.id}&trackId=${track.id}` : '#'"
        :class="cx(optionClass(trackOffset + i), 'text-left w-full')"
        @click="emit('select')"
      >
        <div class="relative size-10 shrink-0 overflow-hidden rounded-md bg-stone-800">
          <img
            v-if="track.release && releaseImage(track.release)"
            :src="releaseImage(track.release)!"
            :alt="track.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-stone-100/50">
            <Music :size="18" :stroke-width="ICON_STROKE_WIDTH" />
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <p class="truncate text-base font-medium text-stone-100">
            {{ track.title }}
          </p>
          <p v-if="track.release?.artist" class="truncate text-xs text-stone-100/60">
            {{ track.release.artist.name }}
            <span v-if="track.release.title" class="text-stone-100/50">· {{ track.release.title }}</span>
          </p>
        </div>
        <span v-if="track.duration" class="text-xs text-stone-100/55 tabular-nums">
          {{ formatDuration(track.duration) }}
        </span>
      </NuxtLink>
    </div>
  </div>
</template>
