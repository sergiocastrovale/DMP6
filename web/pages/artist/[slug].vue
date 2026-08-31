<script setup lang="ts">
import { Loader2, Radar, Trash2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'default',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const {
  artist, error, pending, releases, dlInFlight,
  monitorBusy, toggleMonitor, artistFolders, playingAll, playAll, shufflingAll, shuffleAll,
} = useArtistPage(slug)

const catalogue = useArtistCatalogue(releases)
provide('catalogue', catalogue)

const { isAdmin } = useAuth()

const deleteOpen = ref(false)
</script>

<template>
  <div>
    <div v-if="pending" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-stone-100/40" />
    </div>
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-stone-100">Artist not found</p>
      <p class="mt-1 text-sm text-stone-100/60">The artist you're looking for doesn't exist.</p>
    </div>
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
          <UiButton
            v-if="isAdmin"
            variant="secondary"
            size="sm"
            :icon="Trash2"
            title="Remove this artist from the catalogue, optionally deleting their files"
            @click="deleteOpen = true"
          >
            Remove
          </UiButton>
        </div>
      </ArtistHeader>

      <ArtistDeleteDialog v-if="isAdmin" v-model="deleteOpen" :artist-name="artist.name" />

      <ArtistReleases
        :slug="artist.slug"
        :artist-name="artist.name"
        :releases="releases"
      />
    </div>
  </div>
</template>
