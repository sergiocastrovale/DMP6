<script setup lang="ts">
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/components/TrackList.vue'
import { usePlayerStore } from '~/stores/player'

const props = withDefaults(defineProps<{
  releaseId: string
  columns?: TrackListColumn[]
}>(), {
  columns: () => [
    { key: 'trackNumber', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'favorite' },
    { key: 'duration' },
  ],
})

const player = usePlayerStore()
const { data, pending } = useFetch(`/api/releases/${props.releaseId}/tracks`)

const tracks = computed(() => (data.value as any)?.tracks || [])

function buildPlayerTracks(allTracks: Track[], startTrack: Track) {
  if (!data.value) return
  const release = (data.value as any).release

  const playerTracks = allTracks.map(t => ({
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    artistSlug: release?.artistSlug || null,
    releaseImage: release?.image ? `/img/releases/${release.image}` : null,
    releaseImageUrl: release?.imageUrl || null,
    localReleaseId: t.localReleaseId,
  }))
  const start = playerTracks.find(pt => pt.id === startTrack.id)
  player.setQueue(playerTracks, start)
}
</script>

<template>
  <div>
    <div v-if="pending" class="py-4 text-center text-sm text-zinc-500">Loading tracks...</div>
    <TrackList
      v-else-if="tracks.length"
      :tracks="tracks"
      :columns="columns"
      :build-player-tracks="buildPlayerTracks"
    />
    <div v-else class="py-4 text-center text-sm text-zinc-500">No local tracks available</div>
  </div>
</template>
