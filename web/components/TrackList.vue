<script setup lang="ts">
import { Play, Pause, Heart, AlertTriangle, ExternalLink } from 'lucide-vue-next'
import type { Track } from '~/types/track'
import type { ReleaseStatus } from '~/types/release'
import { usePlayerStore } from '~/stores/player'
import { formatDuration } from '~/helpers/functions'

export interface TrackListColumn {
  key: 'release' | 'trackNumber' | 'title' | 'artist' | 'status' | 'playCount' | 'favorite' | 'duration'
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


function isTrackPlaying(trackId: string) {
  return player.isPlaying && player.currentTrack?.id === trackId
}

function isCurrentTrack(trackId: string) {
  return player.currentTrack?.id === trackId
}

function handleTrackClick(track: Track) {
  if (isCurrentTrack(track.id)) {
    player.togglePlay()
  } else {
    playTrack(track)
  }
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
  <SlimTable>
    <SlimTableHeader>
      <th v-if="hasColumn('release')" class="py-2 pl-4 text-left">Release</th>
      <th v-if="hasColumn('trackNumber')" class="w-12 py-2 pl-4 text-center">#</th>
      <th v-if="hasColumn('title')" class="py-2 pl-3 text-left">Title</th>
      <th v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-left md:table-cell">Artist</th>
      <th v-if="hasColumn('status')" class="hidden py-2 pl-3 text-left sm:table-cell">Status</th>
      <th v-if="hasColumn('playCount')" class="w-16 py-2 pr-3 text-center text-zinc-500">Plays</th>
      <th v-if="hasColumn('duration')" class="w-16 py-2 pr-4 text-center">Time</th>
      <th v-if="hasColumn('favorite')" class="w-12 py-2 text-center" />
    </SlimTableHeader>
    <SlimTableBody>
      <SlimTableRow
        v-for="track in tracks"
        :key="track.id"
        :active="isCurrentTrack(track.id)"
        :muted="track.missing"
        @click="handleTrackClick(track)"
      >
        <td v-if="hasColumn('release')" class="py-2 pl-4 text-zinc-400 text-xs truncate max-w-50">
          {{ releaseMap?.[track.localReleaseId || '']?.title || track.album || '-' }}
        </td>
        <td v-if="hasColumn('trackNumber')" class="py-2 pl-4 text-center text-zinc-500">
          <template v-if="track.missing">
            {{ track.trackNumber || '-' }}
          </template>
          <template v-else>
            <button :class="isCurrentTrack(track.id) ? 'text-amber-500' : 'text-zinc-500 group-hover:text-amber-500'">
              <Pause v-if="isTrackPlaying(track.id)" :size="14" fill="currentColor" />
              <Play v-else :size="14" fill="currentColor" />
            </button>
          </template>
        </td>
        <td v-if="hasColumn('title')" class="py-2 pl-3" :class="[isCurrentTrack(track.id) ? 'text-amber-500' : 'text-zinc-50', track.missing && 'line-through text-zinc-500']">
          <div class="flex items-center gap-2">
            {{ track.title || 'Unknown' }}
            <Popover v-if="track.mbTitle" trigger="hover">
              <template #trigger>
                <AlertTriangle :size="12" class="mb-0.5 ml-1 inline text-amber-500/70" />
              </template>
              <template #content>
                <div class="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                  <p class="text-xs text-zinc-400">Title is slightly different in MusicBrainz: <span class="text-zinc-300">{{ track.mbTitle }}</span></p>
                </div>
              </template>
            </Popover>
          </div>
          <template v-if="track.artists?.length">
            <span class="text-zinc-500"> Feat.
              <template v-for="(a, i) in track.artists" :key="a.slug">
                <NuxtLink :to="`/artist/${a.slug}`" class="text-zinc-400 hover:text-amber-500 transition-colors" @click.stop>{{ a.name }}</NuxtLink><template v-if="i < track.artists.length - 1">, </template>
              </template>
            </span>
          </template>
        </td>
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
        <td v-if="hasColumn('playCount')" class="py-2 pr-3 text-center tabular-nums text-zinc-500">{{ track.playCount ?? 0 }}</td>
        <td v-if="hasColumn('duration')" class="py-2 pr-4 text-center tabular-nums text-zinc-500" :class="track.missing && 'line-through'">{{ formatDuration(track.duration) }}</td>
        <td v-if="hasColumn('favorite')" class="py-2 text-center">
          <div class="flex items-center justify-center gap-1">
            <button
              class="text-zinc-500 transition-colors hover:text-amber-500"
              :class="{ 'text-amber-500': favoriteTracks.has(track.id) }"
              @click.stop="toggleFavorite(track.id)"
            >
              <Heart :size="14" :fill="favoriteTracks.has(track.id) ? 'currentColor' : 'none'" />
            </button>
            <a
              v-if="track.mbTrackMusicbrainzId"
              :href="`https://musicbrainz.org/recording/${track.mbTrackMusicbrainzId}`"
              target="_blank"
              rel="noopener noreferrer"
              class="text-zinc-600 transition-colors hover:text-zinc-400"
              title="View on MusicBrainz"
              @click.stop
            >
              <ExternalLink :size="12" />
            </a>
          </div>
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>
</template>
