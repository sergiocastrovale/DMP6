<script setup lang="ts">
import { Play, Clock, Heart } from 'lucide-vue-next'
import type { Track } from '~/types/track'
import { usePlayerStore } from '~/stores/player'

const props = defineProps<{
  releaseId: string
}>()

const player = usePlayerStore()
const { data, pending } = useFetch(`/api/releases/${props.releaseId}/tracks`)
const favoriteTracks = ref<Set<string>>(new Set())

// Load favorite tracks on mount
onMounted(async () => {
  try {
    const favorites = await $fetch<any>('/api/favorites')
    if (favorites?.tracks) {
      favoriteTracks.value = new Set(favorites.tracks.map((f: any) => f.track.id))
    }
  }
  catch { /* ignore */ }
})

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function playTrack(track: Track) {
  if (!data.value) return
  const release = (data.value as any).release
  const tracks = (data.value as any).tracks as Track[]

  const playerTracks = tracks.map(t => ({
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

  const startTrack = playerTracks.find(t => t.id === track.id)
  player.setQueue(playerTracks, startTrack)
}

function playAll() {
  if (!data.value) return
  const tracks = (data.value as any).tracks as Track[]
  if (tracks.length > 0) playTrack(tracks[0])
}

async function toggleFavorite(trackId: string) {
  const isFavorite = favoriteTracks.value.has(trackId)

  try {
    if (isFavorite) {
      await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
      favoriteTracks.value.delete(trackId)
    }
    else {
      await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'POST' })
      favoriteTracks.value.add(trackId)
    }
  }
  catch { /* ignore */ }
}
</script>

<template>
  <div>
    <div v-if="pending" class="py-4 text-center text-sm text-zinc-500">Loading tracks...</div>
    <div v-else-if="data && (data as any).tracks?.length" class="overflow-hidden rounded-lg border border-zinc-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-800 text-xs text-zinc-500">
            <th class="w-12 py-2 pl-4 text-center">#</th>
            <th class="py-2 pl-3 text-left">Title</th>
            <th class="hidden py-2 pl-3 text-left md:table-cell">Artist</th>
            <th class="w-16 py-2 text-center" />
            <th class="w-16 py-2 pr-4 text-right">
              <Clock :size="14" class="inline" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="track in (data as any).tracks"
            :key="track.id"
            class="group border-b border-zinc-800/50 transition-colors hover:bg-zinc-900 last:border-b-0"
          >
            <td class="py-2 pl-4 text-center text-zinc-500">
              <span class="group-hover:hidden">{{ track.trackNumber || '-' }}</span>
              <button class="hidden group-hover:inline text-zinc-50" @click="playTrack(track)">
                <Play :size="14" />
              </button>
            </td>
            <td class="py-2 pl-3 text-zinc-50">{{ track.title || 'Unknown' }}</td>
            <td class="hidden py-2 pl-3 text-zinc-400 md:table-cell">{{ track.artist || '-' }}</td>
            <td class="py-2 text-center">
              <button
                class="text-zinc-500 transition-colors hover:text-amber-500"
                :class="{ 'text-amber-500': favoriteTracks.has(track.id) }"
                @click.stop="toggleFavorite(track.id)"
              >
                <Heart :size="14" :fill="favoriteTracks.has(track.id) ? 'currentColor' : 'none'" />
              </button>
            </td>
            <td class="py-2 pr-4 text-right tabular-nums text-zinc-500">{{ formatDuration(track.duration) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="py-4 text-center text-sm text-zinc-500">No local tracks available</div>
  </div>
</template>
