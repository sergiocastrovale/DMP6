<script setup lang="ts">
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/types/ui'
import { favoriteTargetId, sortReleaseGroups } from '~/helpers/artistPageLogic'
import { toPlayerTrack } from '~/helpers/playerTrack'
import { useDownloadsStore } from '~/stores/downloads'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'

const props = defineProps<{
  slug: string
  artistName?: string
  releases: UnifiedRelease[]
}>()

const player = usePlayerStore()
const { toggleOrPlay } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const { hasPerm } = useAuth()
const canViewDownloads = hasPerm('sync.view')
const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!

const { searchQuery, sortKey, groups, favoriteReleases, activeStatuses } = catalogue

const listViewColumns: TrackListColumn[] = [
  { key: 'play' },
  { key: 'release', label: 'Release' },
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'playCount', label: 'Plays' },
  { key: 'duration' },
  { key: 'favorite' },
]

const { viewMode, allTracksLoading, releaseMap, filteredAllTracks } = useArtistListView(
  () => props.slug,
  () => props.releases,
  { searchQuery, activeStatuses },
)
const { expandedGroup, expandedEdition, selectedTrackId, toggleGroup, toggleEdition, goToReleaseById, goToBundleParent } = useReleaseExpansion(() => props.releases)
const {
  acquiringIds, acquireRelease,
  redownloadRelease, showRedownloadDialog, openRedownloadDialog, confirmRedownload,
  cancelRelease, showCancelDialog, openCancelDialog, confirmCancelDownload,
  refreshRelease,
  infoRelease, infoExtra, showInfoDialog, openInfoDialog,
  toggleFavoriteRelease,
} = useReleaseActions(favoriteReleases)

onMounted(() => {
  if (!canViewDownloads.value) {
    return
  }
  downloadsStore.checkStatus()
  downloadsStore.fetchDownloadCapabilities()
})

const sortedGroups = computed(() => sortReleaseGroups(groups.value, sortKey.value))

const handleReleaseClick = (r: UnifiedRelease) => toggleOrPlay(r.localReleaseId || r.id, props.slug)

const buildPlayerTracks = (tracks: Track[], startTrack: Track) => {
  const playerTracks = tracks.map(t => toPlayerTrack(t, { artistSlug: props.slug }))
  const start = playerTracks.find(pt => pt.id === startTrack.id)
  player.setQueue(playerTracks, start)
}
</script>

<template>
  <div class="flex flex-col gap-4 p-3 md:px-6">
    <ArtistReleaseFilterBar v-model:view-mode="viewMode" />

    <template v-if="viewMode === 'catalogue'">
      <div>
        <ArtistReleaseGroupRow
          v-for="group in sortedGroups"
          :key="group.key"
          :group="group"
          :slug="slug"
          :expanded-group="expandedGroup"
          :expanded-edition="expandedEdition"
          :favorite-releases="favoriteReleases"
          :selected-track-id="selectedTrackId"
          :acquiring-ids="acquiringIds"
          @toggle-group="toggleGroup"
          @toggle-edition="toggleEdition"
          @play="handleReleaseClick"
          @download="acquireRelease"
          @redownload="openRedownloadDialog"
          @cancel="openCancelDialog"
          @toggle-favorite="toggleFavoriteRelease"
          @refresh="refreshRelease"
          @info="openInfoDialog"
          @go-to-bundle="goToBundleParent"
        />
      </div>

      <UiEmptyState v-if="sortedGroups.length === 0" message="No releases match your filters." hint="Try clearing a status, type or search filter." />
    </template>

    <template v-else>
      <div v-if="allTracksLoading" class="py-8 text-center text-base text-stone-100/55">
        Loading all tracks...
      </div>
      <UiEmptyState v-else-if="filteredAllTracks.length === 0" message="No tracks found." hint="Try clearing a status or search filter." />
      <ArtistTrackList
        v-else
        :tracks="filteredAllTracks"
        :columns="listViewColumns"
        :release-map="releaseMap"
        :build-player-tracks="buildPlayerTracks"
      />
    </template>

    <ReleaseInfoDialog
      v-model="showInfoDialog"
      :release="infoRelease"
      :extra="infoExtra"
      :is-favorite="infoRelease ? favoriteReleases.has(favoriteTargetId(infoRelease) ?? '') : false"
      :is-acquiring="infoRelease ? acquiringIds.has(infoRelease.id) : false"
      removable
      :artist-slug="slug"
      @go-to-release="goToReleaseById"
      @toggle-favorite="infoRelease && toggleFavoriteRelease(infoRelease)"
      @refresh="infoRelease && refreshRelease(infoRelease)"
      @redownload="infoRelease && openRedownloadDialog(infoRelease)"
    />

    <ArtistRedownloadDialog
      v-model="showRedownloadDialog"
      :release="redownloadRelease"
      :artist-name="artistName"
      @confirm="confirmRedownload"
    />

    <DownloadsRejectDialog
      v-model="showCancelDialog"
      :title="cancelRelease?.title ?? null"
      heading="Cancel download"
      verb="Cancel the download of"
      confirm-label="Cancel & delete"
      @confirm="confirmCancelDownload"
    />
  </div>
</template>
