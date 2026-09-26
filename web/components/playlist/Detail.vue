<script setup lang="ts">
import { LucidePlay, LucideTrash2, LucideSparkles, LucideGlobe } from 'lucide-vue-next'
import type { PlaylistDetail } from '~/types/playlist'
import { typography } from '~/helpers/ui'

const props = defineProps<{
  playlist: PlaylistDetail
}>()

defineEmits<{
  play: []
  delete: []
  'remove-track': [trackId: string]
}>()

const isGenrePlaylist = computed(() => props.playlist.type === 'GENRE')
const isRegionPlaylist = computed(() => props.playlist.type === 'REGION')
const isGenerated = computed(() => props.playlist.type !== 'MANUAL')

const coverImages = computed(() => props.playlist.tracks.slice(0, 4).map(pt => ({
  image: pt.track.release?.image ?? null,
  imageUrl: pt.track.release?.imageUrl ?? null,
})))
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
      <div
        class="size-48 shrink-0 overflow-hidden rounded-lg bg-stone-800"
        :class="{ 'genre-border': isGenerated }"
      >
        <PlaylistBlockImageMosaic :images="coverImages" />
      </div>

      <div class="flex flex-1 flex-col gap-4">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-sm text-stone-100/55">Playlist</p>
            <UiBadge v-if="isGenerated" tone="accent">
              <LucideGlobe v-if="isRegionPlaylist" class="size-3" />
              <LucideSparkles v-else class="size-3" />
              Auto-generated
            </UiBadge>
          </div>
          <h1 :class="typography.h1">{{ playlist.name }}</h1>
          <p v-if="playlist.description" class="mt-2 text-base text-stone-100/60">{{ playlist.description }}</p>
        </div>

        <div class="text-sm text-stone-100/55">
          {{ playlist.tracks.length }} {{ playlist.tracks.length === 1 ? 'track' : 'tracks' }}
        </div>

        <div class="flex items-center gap-2">
          <UiButton v-if="playlist.tracks.length > 0" :icon="LucidePlay" @click="$emit('play')">
            Play All
          </UiButton>
          <UiButton v-if="!isGenerated" variant="secondary" :icon="LucideTrash2" @click="$emit('delete')">
            Delete
          </UiButton>
          <template v-if="isGenerated">
            <PlaylistButtonGeneratePlaylists regenerate />
            <PlaylistGeneratedPopover
              v-if="isGenrePlaylist"
              title="How genre playlists work"
              text="Each playlist groups related genres under a single theme. Tracks are pulled from your library based on MusicBrainz genre tags and update whenever you run Regenerate."
            />
            <PlaylistGeneratedPopover
              v-if="isRegionPlaylist"
              title="How region playlists work"
              text="Each playlist groups artists by their country of origin as listed in MusicBrainz. Tracks update whenever you run Regenerate."
            />
          </template>
        </div>
      </div>
    </div>

    <ArtistsTrackTable :rows="playlist.tracks" empty-message="No tracks in this playlist yet">
      <template v-if="!isGenerated" #action="{ row }">
        <UiButton
          variant="ghost"
          size="md"
          icon-only
          :icon="LucideTrash2"
          :aria-label="`Remove ${row.track.title} from playlist`"
          @click.stop="$emit('remove-track', row.track.id)"
        />
      </template>
    </ArtistsTrackTable>
  </div>
</template>
