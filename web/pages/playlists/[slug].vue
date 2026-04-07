<script setup lang="ts">
import { LucideListMusic, LucidePlay, LucidePause, LucideMusic, LucideTrash2, LucideX, LucideSparkles } from 'lucide-vue-next'
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

function toPlayerTrack(pt: PlaylistTrack): PlayerTrack {
  return {
    id: pt.track.id,
    title: pt.track.title,
    artist: pt.track.release?.artist?.name ?? '',
    album: pt.track.release?.title ?? '',
    duration: pt.track.duration ?? 0,
    artistSlug: pt.track.release?.artist?.slug ?? null,
    releaseImage: pt.track.release?.image ?? null,
    releaseImageUrl: pt.track.release?.imageUrl ?? null,
    localReleaseId: pt.track.release?.id ?? null,
  }
}

const playerTracks = computed(() =>
  playlist.value?.tracks.map(toPlayerTrack) ?? [],
)

const coverImages = computed(() => {
  if (!playlist.value) return []
  return playlist.value.tracks.slice(0, 4).map(pt => ({
    image: pt.track.release?.image ?? null,
    imageUrl: pt.track.release?.imageUrl ?? null,
  }))
})

async function loadPlaylist() {
  loading.value = true
  try {
    const data = await $fetch<PlaylistDetail>(`/api/playlists/${slug}`)
    playlist.value = data
  }
  catch (error) {
    console.error('Failed to load playlist:', error)
  }
  finally {
    loading.value = false
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds)
    return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function playAll() {
  if (!playerTracks.value.length)
    return
  playerStore.playTrack(playerTracks.value[0], playerTracks.value)
}

function isTrackPlaying(trackId: string) {
  return playerStore.isPlaying && playerStore.currentTrack?.id === trackId
}

function isCurrentTrack(trackId: string) {
  return playerStore.currentTrack?.id === trackId
}

function handleTrackClick(pt: PlaylistTrack) {
  if (isCurrentTrack(pt.track.id)) {
    playerStore.togglePlay()
  }
  else {
    const track = toPlayerTrack(pt)
    playerStore.playTrack(track, playerTracks.value)
  }
}

async function removeTrack(trackId: string) {
  if (!playlist.value)
    return

  try {
    await $fetch(`/api/playlists/${slug}/tracks/${trackId}`, {
      method: 'DELETE',
    })
    await loadPlaylist()
  }
  catch (error) {
    console.error('Failed to remove track:', error)
    alert('Failed to remove track from playlist')
  }
}

async function deletePlaylist() {
  if (!playlist.value || deleting.value)
    return

  deleting.value = true
  try {
    await $fetch(`/api/playlists/${slug}`, {
      method: 'DELETE',
    })
    router.push('/playlists')
  }
  catch (error) {
    console.error('Failed to delete playlist:', error)
    alert('Failed to delete playlist')
    deleting.value = false
  }
}

onMounted(() => {
  loadPlaylist()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex items-center justify-center py-20"
    >
      <div class="text-zinc-500">
        Loading...
      </div>
    </div>

    <!-- Content -->
    <div
      v-else-if="playlist"
      class="flex flex-col gap-6"
    >
      <!-- Header -->
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div
          class="h-48 w-48 flex-shrink-0 overflow-hidden rounded-sm bg-zinc-800"
          :class="{ 'genre-border': isGenrePlaylist }"
        >
          <PlaylistBlockImageMosaic :images="coverImages" />
        </div>

        <!-- Playlist info -->
        <div class="flex flex-1 flex-col gap-4">
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm text-zinc-500">
                Playlist
              </p>
              <span
                v-if="isGenrePlaylist"
                class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500"
              >
                <LucideSparkles class="size-3" />
                Auto-generated
              </span>
            </div>
            <h1 class="text-3xl font-bold text-zinc-50">
              {{ playlist.name }}
            </h1>
            <p
              v-if="playlist.description"
              class="mt-2 text-sm text-zinc-400"
            >
              {{ playlist.description }}
            </p>
          </div>

          <div class="text-sm text-zinc-500">
            {{ playlist.tracks.length }} {{ playlist.tracks.length === 1 ?
              'track' : 'tracks' }}
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              v-if="playlist.tracks.length > 0"
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
              @click="playAll"
            >
              <LucidePlay
                class="inline size-4 -mt-0.5"
                fill="currentColor"
              />
              Play All
            </button>
            <button
              v-if="!isGenrePlaylist"
              class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
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

      <!-- Tracks table -->
      <div
        v-if="playlist.tracks.length > 0"
        class="rounded-lg border border-zinc-800 bg-zinc-900"
      >
        <div
          v-for="(pt, idx) in playlist.tracks"
          :key="pt.id"
          class="group flex items-center gap-3 border-b border-zinc-800 p-3 last:border-b-0 hover:bg-zinc-800/50 transition-colors"
          :class="{ 'bg-zinc-800/30': isCurrentTrack(pt.track.id) }"
        >
          <!-- Track number / play button -->
          <button
            class="flex size-10 flex-shrink-0 items-center justify-center text-sm"
            :class="isCurrentTrack(pt.track.id) ? 'text-amber-500' : 'text-zinc-500 group-hover:text-amber-500'"
            @click="handleTrackClick(pt)"
          >
            <template v-if="isTrackPlaying(pt.track.id)">
              <LucidePause
                class="size-4"
                fill="currentColor"
              />
            </template>
            <template v-else>
              <span class="group-hover:hidden">{{ idx + 1 }}</span>
              <LucidePlay
                class="hidden size-4 group-hover:block"
                fill="currentColor"
              />
            </template>
          </button>

          <!-- Cover art -->
          <div
            class="relative size-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800"
          >
            <img
              v-if="pt.track.release && releaseImage(pt.track.release)"
              :src="releaseImage(pt.track.release)!"
              :alt="pt.track.title"
              class="h-full w-full object-cover"
            >
            <div
              v-else
              class="flex h-full w-full items-center justify-center text-zinc-600"
            >
              <LucideMusic class="size-5" />
            </div>
          </div>

          <!-- Track info -->
          <div class="flex-1 overflow-hidden">
            <p
              class="truncate text-sm font-medium"
              :class="isCurrentTrack(pt.track.id) ? 'text-amber-500' : 'text-zinc-50'"
            >
              {{ pt.track.title }}
            </p>
            <div
              v-if="pt.track.release"
              class="flex items-center gap-2 text-xs text-zinc-400"
            >
              <NuxtLink
                v-if="pt.track.release.artist"
                :to="`/artist/${pt.track.release.artist.slug}`"
                class="hover:text-zinc-300 transition-colors"
              >
                {{ pt.track.release.artist.name }}
              </NuxtLink>
              <span class="text-zinc-600">•</span>
              <span>{{ pt.track.release.title }}</span>
            </div>
          </div>

          <!-- Duration -->
          <span class="text-xs text-zinc-500">
            {{ formatDuration(pt.track.duration) }}
          </span>

          <!-- Remove button (manual playlists only) -->
          <button
            v-if="!isGenrePlaylist"
            class="rounded-full p-1.5 text-zinc-500 hover:text-zinc-50 opacity-0 transition-opacity group-hover:opacity-100"
            @click="removeTrack(pt.track.id)"
          >
            <LucideX class="size-4" />
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-20 text-center text-zinc-500"
      >
        <LucideMusic class="mb-3 size-12 opacity-50" />
        <p>No tracks in this playlist yet</p>
      </div>
    </div>

    <!-- Not found -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-20 text-center text-zinc-500"
    >
      <LucideListMusic class="mb-3 size-12 opacity-50" />
      <p>Playlist not found</p>
      <NuxtLink
        to="/playlists"
        class="mt-4 text-sm text-amber-500 hover:text-amber-600 transition-colors"
      >
        Back to playlists
      </NuxtLink>
    </div>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        @click.self="showDeleteConfirm = false"
      >
        <div class="w-full max-w-md rounded-lg bg-zinc-900 p-6 shadow-xl">
          <h3 class="mb-4 text-lg font-semibold text-zinc-50">
            Delete Playlist
          </h3>
          <p class="mb-6 text-sm text-zinc-400">
            Are you sure you want to delete "{{ playlist?.name }}"? This action
            cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
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
