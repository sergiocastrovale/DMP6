<script setup lang="ts">
import { LucideListMusic, LucidePlay, LucideTrash2, LucideSparkles, LucideGlobe, LucideX } from 'lucide-vue-next'
import type { PlaylistDetail } from '~/types/playlist'
import type { PlayerTrack } from '~/types/player'
import { typography } from '~/helpers/ui'
import { useToastStore } from '~/stores/toast'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string
const toast = useToastStore()

const loading = ref(true)
const playlist = ref<PlaylistDetail | null>(null)
const showDeleteConfirm = ref(false)

const playerStore = usePlayerStore()

const isGenrePlaylist = computed(() => playlist.value?.type === 'GENRE')
const isRegionPlaylist = computed(() => playlist.value?.type === 'REGION')
const isGenerated = computed(() => playlist.value?.type !== 'MANUAL')

const coverImages = computed(() => {
  if (!playlist.value) { return [] }
  return playlist.value.tracks.slice(0, 4).map(pt => ({
    image: pt.track.release?.image ?? null,
    imageUrl: pt.track.release?.imageUrl ?? null,
  }))
})

const loadPlaylist = async () => {
  loading.value = true
  try {
    playlist.value = await $fetch<PlaylistDetail>(`/api/playlists/${slug}`)
  }
  catch (error) {
    console.error('Failed to load playlist:', error)
  }
  finally {
    loading.value = false
  }
}

const playAll = () => {
  if (!playlist.value?.tracks.length) { return }
  const tracks: PlayerTrack[] = playlist.value.tracks.map(pt => ({
    id: pt.track.id,
    title: pt.track.title,
    artist: pt.track.release?.artist?.name ?? '',
    album: pt.track.release?.title ?? '',
    duration: pt.track.duration ?? 0,
    artistSlug: pt.track.release?.artist?.slug ?? null,
    releaseImage: pt.track.release?.image ?? null,
    releaseImageUrl: pt.track.release?.imageUrl ?? null,
    localReleaseId: pt.track.release?.id ?? null,
  }))
  playerStore.playTrack(tracks[0]!, tracks)
}

const removeTrack = async (trackId: string) => {
  if (!playlist.value) { return }
  try {
    await $fetch(`/api/playlists/${slug}/tracks/${trackId}`, { method: 'DELETE' })
    await loadPlaylist()
  }
  catch (error) {
    console.error('Failed to remove track:', error)
  }
}

const deletePlaylist = async () => {
  if (!playlist.value) { return }
  showDeleteConfirm.value = false
  try {
    await $fetch(`/api/playlists/${slug}`, { method: 'DELETE' })
    router.push('/playlists')
  }
  catch (error) {
    console.error('Failed to delete playlist:', error)
    toast.error(`Failed to delete "${playlist.value.name}"`)
  }
}

onMounted(() => loadPlaylist())
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiLoadingBlock v-if="loading" />

    <div v-else-if="playlist" class="flex flex-col gap-6">
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
            <UiButton v-if="playlist.tracks.length > 0" :icon="LucidePlay" @click="playAll">
              Play All
            </UiButton>
            <UiButton v-if="!isGenerated" variant="secondary" :icon="LucideTrash2" @click="showDeleteConfirm = true">
              Delete
            </UiButton>
            <template v-if="isGenerated">
              <PlaylistRegenerateButton />
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

      <TrackTable :rows="playlist.tracks" empty-message="No tracks in this playlist yet">
        <template v-if="!isGenerated" #action="{ row }">
          <UiButton
            variant="ghost"
            size="md"
            icon-only
            :icon="LucideX"
            :aria-label="`Remove ${row.track.title} from playlist`"
            class="opacity-0 group-hover:opacity-100"
            @click.stop="removeTrack(row.track.id)"
          />
        </template>
      </TrackTable>
    </div>

    <UiEmptyState v-else :icon="LucideListMusic" message="Playlist not found">
      <template #action>
        <UiButton variant="secondary" size="sm" to="/playlists" class="mt-1">
          Back to playlists
        </UiButton>
      </template>
    </UiEmptyState>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Playlist"
      :message="`Are you sure you want to delete &quot;${playlist?.name}&quot;? This action cannot be undone.`"
      confirm-label="Delete"
      variant="danger"
      :icon="LucideTrash2"
      @confirm="deletePlaylist"
    />
  </div>
</template>
