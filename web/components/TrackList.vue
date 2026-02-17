<script setup lang="ts">
import { Play, Clock, Heart } from 'lucide-vue-next'
import type { Track } from '~/types/track'
import type { ReleaseStatus } from '~/types/release'
import { usePlayerStore } from '~/stores/player'

export interface TrackListColumn {
  key: 'release' | 'trackNumber' | 'title' | 'artist' | 'status' | 'favorite' | 'duration'
  label?: string
}

const props = withDefaults(defineProps<{
  tracks: Track[]
  columns?: TrackListColumn[]
  releaseMap?: Record<string, { title: string; status: ReleaseStatus; image: string | null; imageUrl: string | null }>
  buildPlayerTracks?: (tracks: Track[], startTrack: Track) => void
}>(), {
  columns: () => [
    { key: 'trackNumber', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'favorite' },
    { key: 'duration' },
  ],
})

const player = usePlayerStore()
const favoriteTracks = ref<Set<string>>(new Set())

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
  if (props.buildPlayerTracks) {
    props.buildPlayerTracks(props.tracks, track)
    return
  }
  const playerTracks = props.tracks.map(t => ({
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    artistSlug: null,
    releaseImage: null,
    releaseImageUrl: null,
    localReleaseId: t.localReleaseId,
  }))
  const startTrack = playerTracks.find(t => t.id === track.id)
  player.setQueue(playerTracks, startTrack)
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


const statusConfig: Record<string, { label: string; classes: string }> = {
  COMPLETE: { label: 'Complete', classes: 'bg-emerald-500/20 text-emerald-400' },
  INCOMPLETE: { label: 'Incomplete', classes: 'bg-amber-500/20 text-amber-400' },
  EXTRA_TRACKS: { label: 'Extra tracks', classes: 'bg-blue-500/20 text-blue-400' },
  MISSING: { label: 'Missing', classes: 'bg-red-500/20 text-red-400' },
  UNSYNCABLE: { label: 'Unsyncable', classes: 'bg-zinc-700 text-zinc-400' },
  UNKNOWN: { label: 'Unknown', classes: 'bg-zinc-700 text-zinc-400' },
}

function hasColumn(key: string) {
  return props.columns.some(c => c.key === key)
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-zinc-800">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-zinc-800 text-xs text-zinc-500">
          <th v-if="hasColumn('release')" class="py-2 pl-4 text-left">Release</th>
          <th v-if="hasColumn('trackNumber')" class="w-12 py-2 pl-4 text-center">#</th>
          <th v-if="hasColumn('title')" class="py-2 pl-3 text-left">Title</th>
          <th v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-left md:table-cell">Artist</th>
          <th v-if="hasColumn('status')" class="hidden py-2 pl-3 text-left sm:table-cell">Status</th>
          <th v-if="hasColumn('favorite')" class="w-12 py-2 text-center" />
          <th v-if="hasColumn('duration')" class="w-16 py-2 pr-4 text-right">
            <Clock :size="14" class="inline" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="track in tracks"
          :key="track.id"
          class="group border-b border-zinc-800/50 transition-colors hover:bg-zinc-900 last:border-b-0"
        >
          <td v-if="hasColumn('release')" class="py-2 pl-4 text-zinc-400 text-xs truncate max-w-[200px]">
            {{ releaseMap?.[track.localReleaseId || '']?.title || track.album || '-' }}
          </td>
          <td v-if="hasColumn('trackNumber')" class="py-2 pl-4 text-center text-zinc-500">
            <span class="group-hover:hidden">{{ track.trackNumber || '-' }}</span>
            <button class="hidden group-hover:inline text-zinc-50" @click="playTrack(track)">
              <Play :size="14" />
            </button>
          </td>
          <td v-if="hasColumn('title')" class="py-2 pl-3 text-zinc-50">{{ track.title || 'Unknown' }}</td>
          <td v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-zinc-400 md:table-cell">{{ track.artist || '-' }}</td>
          <td v-if="hasColumn('status')" class="hidden py-2 pl-3 sm:table-cell">
            <span
              v-if="releaseMap?.[track.localReleaseId || '']?.status"
              :class="statusConfig[releaseMap[track.localReleaseId || '']?.status || 'UNKNOWN']?.classes"
              class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
            >
              {{ statusConfig[releaseMap[track.localReleaseId || '']?.status || 'UNKNOWN']?.label }}
            </span>
          </td>
          <td v-if="hasColumn('favorite')" class="py-2 text-center">
            <button
              class="text-zinc-500 transition-colors hover:text-amber-500"
              :class="{ 'text-amber-500': favoriteTracks.has(track.id) }"
              @click.stop="toggleFavorite(track.id)"
            >
              <Heart :size="14" :fill="favoriteTracks.has(track.id) ? 'currentColor' : 'none'" />
            </button>
          </td>
          <td v-if="hasColumn('duration')" class="py-2 pr-4 text-right tabular-nums text-zinc-500">{{ formatDuration(track.duration) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
