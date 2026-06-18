<script setup lang="ts">
import { Heart, AlertTriangle, ExternalLink, Info, Link } from 'lucide-vue-next'
import type { Track } from '~/types/track'
import type { ReleaseStatus } from '~/types/release'
import type { TrackListColumn } from '~/types/ui'
import { usePlayerStore } from '~/stores/player'
import { formatDuration } from '~/helpers/functions'

interface TrackInfo {
  filePath: string
  genre: string | null
  bitrate: number | null
  sampleRate: number | null
  fileSize: number | null
  discNumber: number | null
  trackNumber: number | null
  playCount: number
  lastPlayedAt: string | null
  createdAt: string
  mbTrackId: string | null
  mbReleaseId: string | null
  mbReleaseGroupId: string | null
  bpm: string | null
  isrc: string | null
  label: string | null
  acousticId: string | null
  mood: string | null
  key: string | null
  replayGain: string | null
  encoder: string | null
}

const props = withDefaults(defineProps<{
  tracks: Track[]
  columns?: TrackListColumn[]
  releaseMap?: Record<string, { title: string; status: ReleaseStatus; image: string | null; imageUrl: string | null }>
  buildPlayerTracks?: (tracks: Track[], startTrack: Track) => void
  selectedTrackId?: string | null
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
  INCOMPLETE: { label: 'Incomplete', classes: 'bg-accent/20 text-accent' },
  EXTRA_TRACKS: { label: 'Extra tracks', classes: 'bg-blue-500/20 text-blue-400' },
  MISSING: { label: 'Missing', classes: 'bg-red-500/20 text-red-400' },
  UNKNOWN: { label: 'Unknown', classes: 'bg-bg-3 text-ink-2' },
  UNMATCHED: { label: 'Unmatched', classes: 'bg-accent-soft text-accent' },
}

const showInfoDialog = ref(false)
const infoTrack = ref<Track | null>(null)
const infoData = ref<TrackInfo | null>(null)

function hasColumn(key: string) {
  return props.columns.some(c => c.key === key)
}

const openInfoDialog = async (track: Track) => {
  infoTrack.value = track
  infoData.value = null
  showInfoDialog.value = true
  try {
    infoData.value = await $fetch<TrackInfo>(`/api/tracks/${track.id}/info`)
  }
  catch { /* ignore */ }
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <SlimTable>
    <SlimTableHeader>
      <th v-if="hasColumn('play')" class="w-10 py-2 pl-4" />
      <th v-if="hasColumn('release')" class="py-2 pl-4 text-left">Release</th>
      <th v-if="hasColumn('trackNumber')" class="w-12 py-2 pl-4 text-center">#</th>
      <th v-if="hasColumn('title')" class="py-2 pl-3 text-left">Title</th>
      <th v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-left md:table-cell">Artist</th>
      <th v-if="hasColumn('status')" class="hidden py-2 pl-3 text-left sm:table-cell">Status</th>
      <th v-if="hasColumn('playCount')" class="w-16 py-2 pr-3 text-center text-ink0">Plays</th>
      <th v-if="hasColumn('duration')" class="w-16 py-2 pr-4 text-center">Time</th>
      <th v-if="hasColumn('favorite')" class="w-12 py-2 pr-4 text-center" />
    </SlimTableHeader>
    <SlimTableBody>
      <SlimTableRow
        v-for="track in tracks"
        :key="track.id"
        :active="isCurrentTrack(track.id)"
        :muted="track.missing"
        :highlight="track.id === selectedTrackId"
        @click="handleTrackClick(track)"
      >
        <td v-if="hasColumn('play')" class="w-10 py-2 pl-4 text-center">
          <template v-if="!track.missing">
            <PlayerPlayPauseButton
              :playing="isTrackPlaying(track.id)"
              size="sm"
              :class="isCurrentTrack(track.id) ? 'text-accent' : 'text-ink0'"
            />
          </template>
        </td>
        <td v-if="hasColumn('release')" class="py-2 pl-4 text-ink-2 text-xs truncate max-w-50">
          {{ releaseMap?.[track.localReleaseId || '']?.title || track.album || '-' }}
        </td>
        <td v-if="hasColumn('trackNumber')" class="py-2 pl-4 text-center text-ink0">
          <template v-if="hasColumn('play')">
            {{ track.trackNumber || '-' }}
          </template>
          <template v-else-if="track.missing">
            {{ track.trackNumber || '-' }}
          </template>
          <template v-else>
            <PlayerPlayPauseButton
              :playing="isTrackPlaying(track.id)"
              size="sm"
              :class="isCurrentTrack(track.id) ? 'text-accent' : 'text-ink0'"
            />
          </template>
        </td>
        <td v-if="hasColumn('title')" class="py-2 pl-3" :class="[isCurrentTrack(track.id) ? 'text-accent' : 'text-ink', track.missing && 'line-through text-ink0']">
          <div class="flex items-center gap-2">
            {{ track.title || 'Unknown' }}
            <Popover v-if="track.mbTitle" trigger="hover">
              <template #trigger>
                <AlertTriangle :size="12" class="mb-0.5 ml-1 inline text-accent/70" />
              </template>
              <template #content>
                <div class="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
                  <p class="text-xs text-ink-2">Title is slightly different in MusicBrainz: <span class="text-ink-2">{{ track.mbTitle }}</span></p>
                </div>
              </template>
            </Popover>
          </div>
          <template v-if="track.artists?.length">
            <span class="text-ink0"> Feat.
              <template v-for="(a, i) in track.artists" :key="a.slug">
                <NuxtLink v-if="a.hasPage" :to="`/artist/${a.slug}`" class="text-ink-2 hover:text-accent transition-colors" @click.stop>{{ a.name }}</NuxtLink>
                <span v-else class="text-ink-2">{{ a.name }}</span><template v-if="i < track.artists.length - 1">, </template>
              </template>
            </span>
          </template>
        </td>
        <td v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-ink-2 md:table-cell">{{ track.artist || '-' }}</td>
        <td v-if="hasColumn('status')" class="hidden py-2 pl-3 sm:table-cell">
          <span
            v-if="releaseMap?.[track.localReleaseId || '']?.status"
            :class="statusConfig[releaseMap[track.localReleaseId || '']?.status || 'UNKNOWN']?.classes"
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          >
            {{ statusConfig[releaseMap[track.localReleaseId || '']?.status || 'UNKNOWN']?.label }}
          </span>
        </td>
        <td v-if="hasColumn('playCount')" class="py-2 pr-3 text-center tabular-nums text-ink0">{{ track.playCount ?? 0 }}</td>
        <td v-if="hasColumn('duration')" class="py-2 pr-4 text-center tabular-nums text-ink0" :class="track.missing && 'line-through'">{{ formatDuration(track.duration) }}</td>
        <td v-if="hasColumn('favorite')" class="py-2 pr-4 text-center">
          <div class="flex items-center justify-center gap-0.5">
            <button
              class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
              :class="{ 'text-accent': favoriteTracks.has(track.id) }"
              title="Toggle favorite"
              @click.stop="toggleFavorite(track.id)"
            >
              <Heart :size="14" :fill="favoriteTracks.has(track.id) ? 'currentColor' : 'none'" />
            </button>
            <a
              v-if="track.mbTrackMusicbrainzId"
              :href="`https://musicbrainz.org/recording/${track.mbTrackMusicbrainzId}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
              title="View recording on MusicBrainz"
              @click.stop
            >
              <ExternalLink :size="14" />
            </a>
            <a
              v-if="releaseMap?.[track.localReleaseId || ''] && track.localReleaseId"
              :href="`/artist/${$route.params.slug}?release=${(releaseMap[track.localReleaseId]?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`"
              class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
              title="Go to release"
              @click.stop
            >
              <Link :size="14" />
            </a>
            <button
              class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
              title="Track info"
              @click.stop="openInfoDialog(track)"
            >
              <Info :size="14" />
            </button>
          </div>
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>

  <Dialog v-model="showInfoDialog" :title="infoTrack?.title ?? 'Track Info'" max-width="md">
    <template v-if="infoTrack">
      <dl class="space-y-3 text-sm">
        <div>
          <dt class="text-xs text-ink-2">Track ID</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.id }}</dd>
        </div>
        <div v-if="infoTrack.filePath">
          <dt class="text-xs text-ink-2">File path</dt>
          <dd class="font-mono text-xs text-ink-2 break-all">{{ infoTrack.filePath }}</dd>
        </div>
        <div v-if="infoTrack.artist">
          <dt class="text-xs text-ink-2">Artist</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.artist }}</dd>
        </div>
        <div v-if="infoTrack.album">
          <dt class="text-xs text-ink-2">Album</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.album }}</dd>
        </div>
        <div v-if="infoTrack.albumArtist">
          <dt class="text-xs text-ink-2">Album artist</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.albumArtist }}</dd>
        </div>
        <div v-if="infoTrack.genre">
          <dt class="text-xs text-ink-2">Genre</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.genre }}</dd>
        </div>
        <div v-if="infoTrack.trackNumber">
          <dt class="text-xs text-ink-2">Track</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.discNumber ? `Disc ${infoTrack.discNumber}, ` : '' }}Track {{ infoTrack.trackNumber }}</dd>
        </div>
        <div v-if="infoTrack.duration">
          <dt class="text-xs text-ink-2">Duration</dt>
          <dd class="font-mono text-xs text-ink-2">{{ formatDuration(infoTrack.duration) }}</dd>
        </div>
        <div v-if="infoTrack.year">
          <dt class="text-xs text-ink-2">Year</dt>
          <dd class="font-mono text-xs text-ink-2">{{ infoTrack.year }}</dd>
        </div>

        <template v-if="infoData">
          <div v-if="!infoTrack.filePath && infoData.filePath">
            <dt class="text-xs text-ink-2">File path</dt>
            <dd class="font-mono text-xs text-ink-2 break-all">{{ infoData.filePath }}</dd>
          </div>
          <div v-if="infoData.bitrate || infoData.sampleRate">
            <dt class="text-xs text-ink-2">Audio</dt>
            <dd class="font-mono text-xs text-ink-2">{{ [infoData.bitrate ? `${Math.round(infoData.bitrate / 1000)} kbps` : '', infoData.sampleRate ? `${(infoData.sampleRate / 1000).toFixed(1)} kHz` : ''].filter(Boolean).join(' · ') }}</dd>
          </div>
          <div v-if="infoData.fileSize">
            <dt class="text-xs text-ink-2">File size</dt>
            <dd class="font-mono text-xs text-ink-2">{{ formatFileSize(infoData.fileSize) }}</dd>
          </div>
          <div v-if="infoData.bpm">
            <dt class="text-xs text-ink-2">BPM</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.bpm }}</dd>
          </div>
          <div v-if="infoData.key">
            <dt class="text-xs text-ink-2">Key</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.key }}</dd>
          </div>
          <div v-if="infoData.mood">
            <dt class="text-xs text-ink-2">Mood</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.mood }}</dd>
          </div>
          <div v-if="infoData.isrc">
            <dt class="text-xs text-ink-2">ISRC</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.isrc }}</dd>
          </div>
          <div v-if="infoData.label">
            <dt class="text-xs text-ink-2">Label</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.label }}</dd>
          </div>
          <div v-if="infoData.replayGain">
            <dt class="text-xs text-ink-2">Replay gain</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.replayGain }}</dd>
          </div>
          <div v-if="infoData.encoder">
            <dt class="text-xs text-ink-2">Encoder</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.encoder }}</dd>
          </div>
          <div v-if="infoData.acousticId">
            <dt class="text-xs text-ink-2">AcoustID</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.acousticId }}</dd>
          </div>
          <div v-if="infoData.playCount">
            <dt class="text-xs text-ink-2">Play count</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.playCount }}</dd>
          </div>
          <div v-if="infoData.lastPlayedAt">
            <dt class="text-xs text-ink-2">Last played</dt>
            <dd class="font-mono text-xs text-ink-2">{{ new Date(infoData.lastPlayedAt).toLocaleString() }}</dd>
          </div>
          <div v-if="infoData.createdAt">
            <dt class="text-xs text-ink-2">Indexed</dt>
            <dd class="font-mono text-xs text-ink-2">{{ new Date(infoData.createdAt).toLocaleString() }}</dd>
          </div>
          <div v-if="infoData.mbTrackId">
            <dt class="text-xs text-ink-2">MusicBrainz recording</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.mbTrackId }}</dd>
          </div>
          <div v-if="infoData.mbReleaseId">
            <dt class="text-xs text-ink-2">MusicBrainz release</dt>
            <dd class="font-mono text-xs text-ink-2">{{ infoData.mbReleaseId }}</dd>
          </div>
        </template>
      </dl>
    </template>
  </Dialog>
</template>
