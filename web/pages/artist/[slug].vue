<script setup lang="ts">
import { Loader2, Radar } from 'lucide-vue-next'

definePageMeta({
  layout: 'default',
  layoutClasses: 'p-0',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const {
  artist, error, pending, releases, dlInFlight,
  monitorBusy, toggleMonitor, artistFolders, playingAll, playAll,
} = useArtistPage(slug)

const catalogue = useArtistCatalogue(releases)
provide('catalogue', catalogue)
</script>

<template>
  <div>
    <div v-if="pending" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-ink">Artist not found</p>
      <p class="mt-1 text-sm text-ink-2">The artist you're looking for doesn't exist.</p>
    </div>
    <div v-else-if="artist" class="flex flex-col gap-8">
      <ArtistHeader
        :artist="artist"
        :play-disabled="playingAll || !releases.length"
        :active-downloads="dlInFlight"
        class="min-w-0 flex-1"
        @play-all="playAll"
      >
        <div class="flex shrink-0 items-center gap-2">
          <UiButton
            :variant="artist.monitored ? 'primary' : 'secondary'"
            size="sm"
            :icon="Radar"
            :loading="monitorBusy"
            :title="artist.monitored
              ? 'Monitoring: missing releases are downloaded automatically. Click to stop.'
              : 'Start monitoring: auto-download missing releases into the approval queue.'"
            @click="toggleMonitor"
          >
            Monitor {{ artist.monitored ? 'ON' : 'OFF' }}
          </UiButton>
          <ArtistScanActions :artist-name="artist.name" :folders="artistFolders" />
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
