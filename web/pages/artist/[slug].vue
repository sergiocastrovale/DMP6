<script setup lang="ts">
import { useTerminalStore } from '~/stores/terminal'
import { pageWidth } from '~/helpers/ui'

definePageMeta({
  layout: 'default',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const {
  artist, error, pending, releases, dlInFlight, refreshDownloadStatus,
  monitorBusy, toggleMonitor, artistFolders, playingAll, playAll, shufflingAll, shuffleAll,
  photoBusy, fetchPhoto,
} = useArtistPage(slug)

const catalogue = useArtistCatalogue(releases)
provide('catalogue', catalogue)
provide('refreshDownloadStatus', refreshDownloadStatus)

const { isAdmin, hasPerm } = useAuth()
const canMonitor = hasPerm('downloads.crud')
const canScan = hasPerm('sync.run')

const terminal = useTerminalStore()
const canFetchPhoto = computed(() => canScan.value && !!artist.value?.musicbrainzId && !terminal.isRunning)

watch(() => artist.value?.name, (name) => {
  if (name) {
    useTitle(name)
  }
})
</script>

<template>
  <div :class="pageWidth">
    <UiLoadingBlock v-if="pending" />
    <ArtistNotFound v-else-if="error" />
    <div v-else-if="artist" class="flex flex-col gap-8">
      <ArtistHeader
        :artist="artist"
        :play-disabled="playingAll || !releases.length"
        :shuffle-disabled="shufflingAll || !releases.length"
        :active-downloads="dlInFlight"
        :can-fetch-photo="canFetchPhoto"
        :photo-busy="photoBusy"
        class="hidden min-w-0 flex-1 md:flex"
        @play-all="playAll"
        @shuffle-all="shuffleAll"
        @fetch-photo="fetchPhoto"
      >
        <div class="flex shrink-0 items-center gap-2">
          <ArtistButtonMonitor v-if="canMonitor" :monitored="artist.monitored" :busy="monitorBusy" @toggle="toggleMonitor" />
          <ArtistScanActions v-if="canScan" :artist-name="artist.name" :folders="artistFolders" />
          <ArtistButtonRemove v-if="isAdmin" :artist-name="artist.name" />
        </div>
      </ArtistHeader>

      <ArtistMobileHeader
        :artist="artist"
        :play-disabled="playingAll || !releases.length"
        :shuffle-disabled="shufflingAll || !releases.length"
        :active-downloads="dlInFlight"
        class="md:hidden"
        @play-all="playAll"
        @shuffle-all="shuffleAll"
      >
        <ArtistButtonMonitor v-if="canMonitor" :monitored="artist.monitored" :busy="monitorBusy" @toggle="toggleMonitor" />
        <ArtistScanActions v-if="canScan" :artist-name="artist.name" :folders="artistFolders" />
        <ArtistButtonRemove v-if="isAdmin" :artist-name="artist.name" />
      </ArtistMobileHeader>

      <ArtistDidYouKnow :slug="artist.slug" class="mx-3 md:mx-6" />

      <ArtistReleases
        :slug="artist.slug"
        :artist-name="artist.name"
        :releases="releases"
      />
    </div>
  </div>
</template>
