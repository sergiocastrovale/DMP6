<script setup lang="ts">
import { AlertTriangle, ExternalLink, Info, Link } from 'lucide-vue-next'
import type { Track, TrackInfo } from '~/types/track'
import type { ReleaseStatus } from '~/types/release'
import type { TrackListColumn } from '~/types/ui'
import { usePlayerStore } from '~/stores/player'
import { formatDuration } from '~/helpers/functions'
import { releaseTitleSlug } from '~/helpers/artistPageLogic'
import { toPlayerTrack } from '~/helpers/playerTrack'
import { cx, surface } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  tracks: Track[]
  columns?: TrackListColumn[]
  releaseMap?: Record<string, { title: string; status: ReleaseStatus; image: string | null; imageUrl: string | null }>
  buildPlayerTracks?: (tracks: Track[], startTrack: Track) => void
  selectedTrackId?: string | null
  discTitles?: Record<number, string>
}>(), {
  releaseMap: undefined,
  buildPlayerTracks: undefined,
  selectedTrackId: null,
  discTitles: () => ({}),
  columns: () => [
    { key: 'trackNumber', label: '#' },
    { key: 'title', label: 'Title' },
    { key: 'favorite' },
    { key: 'duration' },
  ],
})

const player = usePlayerStore()
const api = useApi()
const { favoriteTracks, toggleFavorite } = useTrackFavorites(() => props.tracks)

const isTrackPlaying = (trackId: string) => {
  return player.isPlaying && player.currentTrack?.id === trackId
}

const isCurrentTrack = (trackId: string) => {
  return player.currentTrack?.id === trackId
}

const handleTrackClick = (track: Track) => {
  if (isCurrentTrack(track.id)) {
    player.togglePlay()
  } else {
    playTrack(track)
  }
}

const playTrack = (track: Track) => {
  if (props.buildPlayerTracks) {
    props.buildPlayerTracks(props.tracks, track)
    return
  }
  const playerTracks = props.tracks.map((t) => {
    const release = props.releaseMap?.[t.localReleaseId || '']
    return toPlayerTrack(t, { releaseImage: release?.image, releaseImageUrl: release?.imageUrl })
  })
  const startTrack = playerTracks.find(t => t.id === track.id)
  player.setQueue(playerTracks, startTrack)
}

const showInfoDialog = ref(false)
const infoTrack = ref<Track | null>(null)
const infoData = ref<TrackInfo | null>(null)

const hasColumn = (key: string) => {
  return props.columns.some(c => c.key === key)
}

// Disc subheaders only make sense for a single release's own tracks (never the cross-release "list
// view", which already labels each row with its release via the `release` column) and only once
// there's more than one disc to separate.
const trackGroups = computed(() => {
  const discNumbers = new Set(props.tracks.map(t => t.discNumber ?? 1))
  if (hasColumn('release') || discNumbers.size < 2) {
    return [{ discNumber: null as number | null, tracks: props.tracks }]
  }
  const groups: { discNumber: number | null, tracks: Track[] }[] = []
  for (const track of props.tracks) {
    const disc = track.discNumber ?? 1
    const current = groups.at(-1)
    if (!current || current.discNumber !== disc) {
      groups.push({ discNumber: disc, tracks: [track] })
    } else {
      current.tracks.push(track)
    }
  }
  return groups
})

const openInfoDialog = async (track: Track) => {
  infoTrack.value = track
  infoData.value = null
  showInfoDialog.value = true
  infoData.value = await api.load(() => $fetch<TrackInfo>(`/api/tracks/${track.id}/info`), 'Could not load the track info')
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
      <th v-if="hasColumn('playCount')" class="w-16 py-2 pr-3 text-center text-stone-100/55">Plays</th>
      <th v-if="hasColumn('duration')" class="w-16 py-2 pr-4 text-center">Time</th>
      <th v-if="hasColumn('favorite')" class="w-12 py-2 pr-4 text-center" />
    </SlimTableHeader>
    <SlimTableBody>
      <template v-for="group in trackGroups" :key="group.discNumber ?? 'all'">
        <tr v-if="group.discNumber !== null">
          <td :colspan="columns.length" class="pt-3 pb-1 pl-4 text-xs font-semibold uppercase tracking-wide text-stone-100/40">Disc {{ group.discNumber }}<span v-if="discTitles[group.discNumber]" class="normal-case font-medium tracking-normal"> — {{ discTitles[group.discNumber] }}</span></td>
        </tr>
        <SlimTableRow
          v-for="track in group.tracks"
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
                :class="isCurrentTrack(track.id) ? 'text-amber-400' : 'text-stone-100/55'"
              />
            </template>
          </td>
          <td v-if="hasColumn('release')" class="py-2 pl-4 text-stone-100/60 text-xs truncate max-w-50">
            {{ releaseMap?.[track.localReleaseId || '']?.title || track.album || '-' }}
          </td>
          <td v-if="hasColumn('trackNumber')" class="py-2 pl-4 text-center text-stone-100/55">
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
                :class="isCurrentTrack(track.id) ? 'text-amber-400' : 'text-stone-100/55'"
              />
            </template>
          </td>
          <td v-if="hasColumn('title')" class="py-2 pl-3" :class="[isCurrentTrack(track.id) ? 'text-amber-400' : 'text-stone-100', track.missing && 'line-through text-stone-100/55']">
            <div class="flex items-center gap-2">
              {{ track.title || 'Unknown' }}
              <Popover v-if="track.mbTitle" trigger="hover" teleport>
                <template #trigger>
                  <AlertTriangle :size="12" class="mb-0.5 ml-1 inline text-amber-400/70" />
                </template>
                <template #content>
                  <div :class="cx(surface.popover, 'w-72 p-3')">
                    <p class="text-xs text-stone-100/60">Title is slightly different in MusicBrainz: <span class="text-stone-100/60">{{ track.mbTitle }}</span></p>
                  </div>
                </template>
              </Popover>
            </div>
            <template v-if="track.artists?.length">
              <span class="text-stone-100/55"> Feat.
                <template v-for="(a, i) in track.artists" :key="a.slug">
                  <NuxtLink :to="`/artist/${a.slug}`" class="text-stone-100/60 hover:text-amber-400 transition-colors" @click.stop>{{ a.name }}</NuxtLink><template v-if="i < track.artists.length - 1">, </template>
                </template>
              </span>
            </template>
          </td>
          <td v-if="hasColumn('artist')" class="hidden py-2 pl-3 text-stone-100/60 md:table-cell">{{ track.artist || '-' }}</td>
          <td v-if="hasColumn('status')" class="hidden py-2 pl-3 sm:table-cell">
            <ReleaseStatusBadge v-if="releaseMap?.[track.localReleaseId || '']?.status" :status="releaseMap[track.localReleaseId || '']!.status" />
          </td>
          <td v-if="hasColumn('playCount')" class="py-2 pr-3 text-center tabular-nums text-stone-100/55">{{ track.playCount ?? 0 }}</td>
          <td v-if="hasColumn('duration')" class="py-2 pr-4 text-center tabular-nums text-stone-100/55" :class="track.missing && 'line-through'">{{ formatDuration(track.duration) }}</td>
          <td v-if="hasColumn('favorite')" class="py-2 pr-4 text-center">
            <div class="flex items-center justify-center gap-0.5">
              <ToggleFavorite
                :size="16"
                :active="favoriteTracks.has(track.id)"
                label="Toggle favorite"
                @toggle="toggleFavorite(track.id)"
              />
              <DataTableAction
                v-if="track.mbTrackMusicbrainzId"
                :icon="ExternalLink"
                label="View recording on MusicBrainz"
                :href="`https://musicbrainz.org/recording/${track.mbTrackMusicbrainzId}`"
                @click.stop
              />
              <DataTableAction
                v-if="releaseMap?.[track.localReleaseId || ''] && track.localReleaseId"
                :icon="Link"
                label="Go to release"
                :href="`/artist/${$route.params.slug}?release=${releaseTitleSlug(releaseMap[track.localReleaseId]?.title || '')}`"
                @click.stop
              />
              <DataTableAction
                :icon="Info"
                label="Track info"
                @click.stop="openInfoDialog(track)"
              />
            </div>
          </td>
        </SlimTableRow>
      </template>
    </SlimTableBody>
  </SlimTable>

  <ArtistTrackInfoDialog v-model="showInfoDialog" :track="infoTrack" :info="infoData" />
</template>
