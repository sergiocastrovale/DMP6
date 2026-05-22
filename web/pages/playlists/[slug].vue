<script setup lang="ts">
import { LucideListMusic, LucidePlay, LucideTrash2, LucideSparkles } from 'lucide-vue-next'
import type { PlaylistDetail, PlaylistTrack } from '~/types/playlist'
import type { PlayerTrack } from '~/types/player'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const loading = ref(true)
const playlist = ref<PlaylistDetail | null>(null)
const deleting = ref(false)
const showDeleteConfirm = ref(false)

const playerStore = usePlayerStore()
const { releaseImage } = useImageUrl()

const isGenrePlaylist = computed(() => playlist.value?.type === 'GENRE')

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
  if (!playlist.value || deleting.value) { return }
  deleting.value = true
  try {
    await $fetch(`/api/playlists/${slug}`, { method: 'DELETE' })
    router.push('/playlists')
  }
  catch (error) {
    console.error('Failed to delete playlist:', error)
    deleting.value = false
  }
}

onMounted(() => loadPlaylist())
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-ink0">Loading...</div>
    </div>

    <div v-else-if="playlist" class="flex flex-col gap-6">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div
          class="h-48 w-48 flex-shrink-0 overflow-hidden rounded-sm bg-bg-2"
          :class="{ 'genre-border': isGenrePlaylist }"
        >
          <PlaylistBlockImageMosaic :images="coverImages" />
        </div>

        <div class="flex flex-1 flex-col gap-4">
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm text-ink0">Playlist</p>
              <span
                v-if="isGenrePlaylist"
                class="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
              >
                <LucideSparkles class="size-3" />
                Auto-generated
              </span>
            </div>
            <h1 class="text-3xl font-bold text-ink">{{ playlist.name }}</h1>
            <p v-if="playlist.description" class="mt-2 text-sm text-ink-2">{{ playlist.description }}</p>
          </div>

          <div class="text-sm text-ink0">
            {{ playlist.tracks.length }} {{ playlist.tracks.length === 1 ? 'track' : 'tracks' }}
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="playlist.tracks.length > 0"
              class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent transition-colors"
              @click="playAll"
            >
              <LucidePlay class="inline size-4 -mt-0.5" fill="currentColor" />
              Play All
            </button>
            <button
              v-if="!isGenrePlaylist"
              class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-2 hover:bg-bg-2 transition-colors"
              @click="showDeleteConfirm = true"
            >
              <LucideTrash2 class="inline size-4 -mt-0.5" />
              Delete
            </button>
            <template v-if="isGenrePlaylist">
              <PlaylistRegenerateButton />
              <PlaylistGenreInfoPopover />
            </template>
          </div>
        </div>
      </div>

      <PlaylistTrackTable
        :tracks="playlist.tracks"
        :is-genre="isGenrePlaylist"
        @remove="removeTrack"
      />
    </div>

    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
      <LucideListMusic class="mb-3 size-12 opacity-50" />
      <p>Playlist not found</p>
      <NuxtLink to="/playlists" class="mt-4 text-sm text-accent hover:text-accent transition-colors">
        Back to playlists
      </NuxtLink>
    </div>

    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        @click.self="showDeleteConfirm = false"
      >
        <div class="w-full max-w-md rounded-lg bg-bg-1 p-6 shadow-xl">
          <h3 class="mb-4 text-lg font-semibold text-ink">Delete Playlist</h3>
          <p class="mb-6 text-sm text-ink-2">
            Are you sure you want to delete "{{ playlist?.name }}"? This action cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-rule px-4 py-2 text-sm text-ink-2 hover:bg-bg-2 transition-colors"
              @click="showDeleteConfirm = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              :disabled="deleting"
              @click="deletePlaylist"
            >
              {{ deleting ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@property --angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.genre-border {
  border: 2px solid transparent;
  border-radius: 0.5rem;
  background:
    linear-gradient(var(--color-surface), var(--color-surface)) padding-box,
    conic-gradient(from var(--angle), #f59e0b, #fbbf24, #f59e0b, #d97706, #f59e0b) border-box;
  animation: rotate-gradient 3s linear infinite;
}

@keyframes rotate-gradient {
  to {
    --angle: 360deg;
  }
}
</style>
