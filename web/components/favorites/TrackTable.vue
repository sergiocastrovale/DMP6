<script setup lang="ts">
import { LucideHeart, LucideMusic, LucidePlay, LucidePause } from 'lucide-vue-next'
import type { FavoriteTrack } from '~/types/favorites'
import { formatDuration } from '~/helpers/functions'

const props = defineProps<{
  tracks: FavoriteTrack[]
}>()

const emit = defineEmits<{
  unfavorite: [trackId: string]
}>()

const { releaseImage } = useImageUrl()
const playerStore = usePlayerStore()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')

const isCurrentTrack = (trackId: string) => playerStore.currentTrack?.id === trackId
const isTrackPlaying = (trackId: string) => playerStore.isPlaying && isCurrentTrack(trackId)

const toPlayerTrack = (fav: FavoriteTrack) => ({
  id: fav.track.id,
  title: fav.track.title || 'Unknown',
  artist: fav.track.release?.artist?.name || 'Unknown',
  album: fav.track.release?.title || 'Unknown',
  duration: fav.track.duration || 0,
  artistSlug: fav.track.release?.artist?.slug || null,
  releaseImage: fav.track.release?.image || null,
  releaseImageUrl: fav.track.release?.imageUrl || null,
  localReleaseId: fav.track.release?.id || null,
})

const handleTrackClick = (fav: FavoriteTrack) => {
  if (isCurrentTrack(fav.track.id)) {
    playerStore.togglePlay()
  } else {
    const playerTracks = props.tracks.map(toPlayerTrack)
    const start = playerTracks.find(t => t.id === fav.track.id)
    playerStore.setQueue(playerTracks, start)
  }
}
</script>

<template>
  <Table v-if="tracks.length > 0">
    <TableRow
      v-for="fav in tracks"
      :key="fav.id"
      :active="isCurrentTrack(fav.track.id)"
    >
      <button
        class="flex size-10 shrink-0 items-center justify-center text-sm"
        :class="isCurrentTrack(fav.track.id) ? 'text-accent' : 'text-ink0 group-hover:text-accent'"
        @click="handleTrackClick(fav)"
      >
        <LucidePause v-if="isTrackPlaying(fav.track.id)" :size="16" fill="currentColor" />
        <LucidePlay v-else :size="16" fill="currentColor" />
      </button>

      <div class="relative size-10 flex-shrink-0 overflow-hidden rounded bg-bg-2">
        <img
          v-if="fav.track.release && releaseImage(fav.track.release)"
          :src="releaseImage(fav.track.release)!"
          :alt="fav.track.title"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
          <LucideMusic class="size-5" />
        </div>
      </div>

      <div class="flex-1 overflow-hidden">
        <p class="truncate text-sm font-medium" :class="isCurrentTrack(fav.track.id) ? 'text-accent' : 'text-ink'">
          {{ fav.track.title }}
        </p>
        <div v-if="fav.track.release" class="flex items-center gap-2 text-xs text-ink-2">
          <NuxtLink
            v-if="fav.track.release.artist"
            :to="`/artist/${fav.track.release.artist.slug}`"
            class="hover:text-ink-2 transition-colors"
          >
            {{ fav.track.release.artist.name }}
          </NuxtLink>
          <span class="text-ink-4">&bull;</span>
          <span>{{ fav.track.release.title }}</span>
        </div>
      </div>

      <span class="text-xs text-ink0">
        {{ formatDuration(fav.track.duration) }}
      </span>

      <button
        v-if="canCrud"
        class="rounded-full p-1.5 text-accent opacity-0 transition-opacity group-hover:opacity-100"
        @click="emit('unfavorite', fav.track.id)"
      >
        <LucideHeart class="size-4" fill="currentColor" />
      </button>
    </TableRow>
  </Table>

  <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
    <LucideMusic class="mb-3 size-12 opacity-50" />
    <p>No favorite tracks yet</p>
  </div>
</template>
