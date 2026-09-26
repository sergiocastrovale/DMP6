<script setup lang="ts">
import { toPlayerTrack } from '~/helpers/playerTrack'
import type { ReleaseTracksResponse, Track } from '~/types/track'
import type { TrackListColumn } from '~/types/ui'
import { usePlayerStore } from '~/stores/player'

const props = withDefaults(defineProps<{
  releaseId: string
  columns?: TrackListColumn[]
  selectedTrackId?: string | null
}>(), {
  selectedTrackId: null,
  columns: () => [
    { key: 'trackNumber', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'favorite' },
    { key: 'duration' },
  ],
})

const player = usePlayerStore()
const { data, pending } = useFetch<ReleaseTracksResponse>(`/api/releases/${props.releaseId}/tracks`)

const tracks = computed(() => data.value?.tracks ?? [])
const discTitles = computed(() => data.value?.discTitles ?? {})

const buildPlayerTracks = (allTracks: Track[], startTrack: Track) => {
  if (!data.value) {return}
  const release = data.value.release

  const playerTracks = allTracks
    .filter(t => !t.missing)
    .map(t => toPlayerTrack(t, { artistSlug: release?.artistSlug, releaseImage: release?.image, releaseImageUrl: release?.imageUrl }))
  const start = playerTracks.find(pt => pt.id === startTrack.id)
  player.setQueue(playerTracks, start)
}
</script>

<template>
  <div class="mt-4 mb-1">
    <div v-if="pending" class="py-4 text-center text-sm text-stone-100/55">Loading tracks...</div>
    <ArtistTrackList
      v-else-if="tracks.length"
      :tracks="tracks"
      :disc-titles="discTitles"
      :columns="columns"
      :build-player-tracks="buildPlayerTracks"
      :selected-track-id="selectedTrackId"
    />
    <div v-else class="py-4 text-center text-sm text-stone-100/55">No local tracks available</div>
  </div>
</template>
