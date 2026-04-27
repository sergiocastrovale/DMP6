<script setup lang="ts">
import { LucidePlay, LucidePause, LucideMusic, LucideX } from 'lucide-vue-next'
import type { PlaylistTrack } from '~/types/playlist'
import type { PlayerTrack } from '~/types/player'
import { formatDuration } from '~/helpers/functions'

const props = defineProps<{
  tracks: PlaylistTrack[]
  isGenre: boolean
}>()

const emit = defineEmits<{
  remove: [trackId: string]
}>()

const playerStore = usePlayerStore()
const { releaseImage } = useImageUrl()

const toPlayerTrack = (pt: PlaylistTrack): PlayerTrack => ({
  id: pt.track.id,
  title: pt.track.title,
  artist: pt.track.release?.artist?.name ?? '',
  album: pt.track.release?.title ?? '',
  duration: pt.track.duration ?? 0,
  artistSlug: pt.track.release?.artist?.slug ?? null,
  releaseImage: pt.track.release?.image ?? null,
  releaseImageUrl: pt.track.release?.imageUrl ?? null,
  localReleaseId: pt.track.release?.id ?? null,
})

const playerTracks = computed(() => props.tracks.map(toPlayerTrack))
const isCurrentTrack = (trackId: string) => playerStore.currentTrack?.id === trackId
const isTrackPlaying = (trackId: string) => playerStore.isPlaying && isCurrentTrack(trackId)

const handleTrackClick = (pt: PlaylistTrack) => {
  if (isCurrentTrack(pt.track.id)) {
    playerStore.togglePlay()
  } else {
    const track = toPlayerTrack(pt)
    playerStore.playTrack(track, playerTracks.value)
  }
}
</script>

<template>
  <Table v-if="tracks.length > 0">
    <TableRow
      v-for="(pt, idx) in tracks"
      :key="pt.id"
      :active="isCurrentTrack(pt.track.id)"
    >
      <button
        class="flex size-10 flex-shrink-0 items-center justify-center text-sm"
        :class="isCurrentTrack(pt.track.id) ? 'text-amber-500' : 'text-zinc-500 group-hover:text-amber-500'"
        @click="handleTrackClick(pt)"
      >
        <template v-if="isTrackPlaying(pt.track.id)">
          <LucidePause class="size-4" fill="currentColor" />
        </template>
        <template v-else>
          <span class="group-hover:hidden">{{ idx + 1 }}</span>
          <LucidePlay class="hidden size-4 group-hover:block" fill="currentColor" />
        </template>
      </button>

      <div class="relative size-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
        <img
          v-if="pt.track.release && releaseImage(pt.track.release)"
          :src="releaseImage(pt.track.release)!"
          :alt="pt.track.title"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
          <LucideMusic class="size-5" />
        </div>
      </div>

      <div class="flex-1 overflow-hidden">
        <p class="truncate text-sm font-medium" :class="isCurrentTrack(pt.track.id) ? 'text-amber-500' : 'text-zinc-50'">
          {{ pt.track.title }}
        </p>
        <div v-if="pt.track.release" class="flex items-center gap-2 text-xs text-zinc-400">
          <NuxtLink
            v-if="pt.track.release.artist"
            :to="`/artist/${pt.track.release.artist.slug}`"
            class="hover:text-zinc-300 transition-colors"
          >
            {{ pt.track.release.artist.name }}
          </NuxtLink>
          <span class="text-zinc-600">&bull;</span>
          <span>{{ pt.track.release.title }}</span>
        </div>
      </div>

      <span class="text-xs text-zinc-500">
        {{ formatDuration(pt.track.duration) }}
      </span>

      <button
        v-if="!isGenre"
        class="rounded-full p-1.5 text-zinc-500 hover:text-zinc-50 opacity-0 transition-opacity group-hover:opacity-100"
        @click="emit('remove', pt.track.id)"
      >
        <LucideX class="size-4" />
      </button>
    </TableRow>
  </Table>

  <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
    <LucideMusic class="mb-3 size-12 opacity-50" />
    <p>No tracks in this playlist yet</p>
  </div>
</template>
