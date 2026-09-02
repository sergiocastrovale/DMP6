<script setup lang="ts">
definePageMeta({
  layout: 'default',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const {
  artist, error, pending, releases, dlInFlight, refreshDownloadStatus,
  monitorBusy, toggleMonitor, artistFolders, playingAll, playAll, shufflingAll, shuffleAll,
} = useArtistPage(slug)

const catalogue = useArtistCatalogue(releases)
provide('catalogue', catalogue)
provide('refreshDownloadStatus', refreshDownloadStatus)

const { isAdmin } = useAuth()

watch(() => artist.value?.name, (name) => {
  if (name) {
    useTitle(name)
  }
})
</script>

<template>
  <div>
    <UiLoadingBlock v-if="pending" />
    <ArtistNotFound v-else-if="error" />
    <div v-else-if="artist" class="flex flex-col gap-8">
      <ArtistHeader
        :artist="artist"
        :play-disabled="playingAll || !releases.length"
        :shuffle-disabled="shufflingAll || !releases.length"
        :active-downloads="dlInFlight"
        class="min-w-0 flex-1"
        @play-all="playAll"
        @shuffle-all="shuffleAll"
      >
        <div class="flex shrink-0 items-center gap-2">
          <ArtistButtonMonitor :monitored="artist.monitored" :busy="monitorBusy" @toggle="toggleMonitor" />
          <ArtistScanActions :artist-name="artist.name" :folders="artistFolders" />
          <ArtistButtonRemove v-if="isAdmin" :artist-name="artist.name" />
        </div>
      </ArtistHeader>

      <ArtistReleases
        :slug="artist.slug"
        :artist-name="artist.name"
        :releases="releases"
      />
    </div>
  </div>
</template>
