<script setup lang="ts">
import { LucideListMusic, LucidePlay, LucideMusic, LucideTrash2, LucideX } from 'lucide-vue-next'
import type { PlaylistDetail } from '~/types/playlist'

const { isStreamMode } = useStreamMode()
if (isStreamMode.value) {
  navigateTo('/')
}

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const loading = ref(true)
const playlist = ref<PlaylistDetail | null>(null)
const deleting = ref(false)
const showDeleteConfirm = ref(false)

const playerStore = usePlayerStore()
const { releaseImage } = useImageUrl()

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
  if (!playlist.value || playlist.value.tracks.length === 0)
    return
  const tracks = playlist.value.tracks.map(pt => pt.track)
  playerStore.playTrack(tracks[0], tracks as any)
}

function playTrack(track: any) {
  playerStore.playTrack(track, [track])
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
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">
        Loading...
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="playlist" class="flex flex-col gap-6">
      <!-- Header -->
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start">
        <!-- Playlist cover (mosaic) -->
        <div class="h-48 w-48 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800">
          <div
            v-if="playlist.tracks.length > 0"
            class="grid h-full w-full grid-cols-2"
          >
            <div
              v-for="(pt, idx) in playlist.tracks.slice(0, 4)"
              :key="idx"
              class="relative overflow-hidden bg-zinc-900"
            >
              <img
                v-if="pt.track.release && releaseImage(pt.track.release)"
                :src="releaseImage(pt.track.release)!"
                :alt="`Cover ${idx + 1}`"
                class="h-full w-full object-cover"
              >
              <div
                v-else
                class="flex h-full w-full items-center justify-center text-zinc-700"
              >
                <LucideMusic class="size-8" />
              </div>
            </div>
          </div>
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-zinc-600"
          >
            <LucideListMusic class="size-12" />
          </div>
        </div>

        <!-- Playlist info -->
        <div class="flex flex-1 flex-col gap-4">
          <div>
            <p class="text-sm text-zinc-500">
              Playlist
            </p>
            <h1 class="text-3xl font-bold text-zinc-50">
              {{ playlist.name }}
            </h1>
            <p v-if="playlist.description" class="mt-2 text-sm text-zinc-400">
              {{ playlist.description }}
            </p>
          </div>

          <div class="text-sm text-zinc-500">
            {{ playlist.tracks.length }} {{ playlist.tracks.length === 1 ? 'track' : 'tracks' }}
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              v-if="playlist.tracks.length > 0"
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
              @click="playAll"
            >
              <LucidePlay class="inline size-4 -mt-0.5" fill="currentColor" />
              Play All
            </button>
            <button
              class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
              @click="showDeleteConfirm = true"
            >
              <LucideTrash2 class="inline size-4 -mt-0.5" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Tracks table -->
      <div v-if="playlist.tracks.length > 0" class="rounded-lg border border-zinc-800 bg-zinc-900">
        <div
          v-for="(pt, idx) in playlist.tracks"
          :key="pt.id"
          class="group flex items-center gap-3 border-b border-zinc-800 p-3 last:border-b-0 hover:bg-zinc-800/50 transition-colors"
        >
          <!-- Track number / play button -->
          <button
            class="flex size-10 flex-shrink-0 items-center justify-center text-sm text-zinc-500 group-hover:text-amber-500"
            @click="playTrack(pt.track)"
          >
            <span class="group-hover:hidden">{{ idx + 1 }}</span>
            <LucidePlay class="hidden size-4 group-hover:block" fill="currentColor" />
          </button>

          <!-- Cover art -->
          <div class="relative size-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
            <img
              v-if="pt.track.release && releaseImage(pt.track.release)"
              :src="releaseImage(pt.track.release)!"
              :alt="pt.track.title"
              class="h-full w-full object-cover"
            >
            <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
              <LucideMusic class="size-5" />
            </div>
          </div>

          <!-- Track info -->
          <div class="flex-1 overflow-hidden">
            <p class="truncate text-sm font-medium text-zinc-50">
              {{ pt.track.title }}
            </p>
            <div v-if="pt.track.release" class="flex items-center gap-2 text-xs text-zinc-400">
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

          <!-- Remove button -->
          <button
            class="rounded-full p-1.5 text-zinc-500 hover:text-zinc-50 opacity-0 transition-opacity group-hover:opacity-100"
            @click="removeTrack(pt.track.id)"
          >
            <LucideX class="size-4" />
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
        <LucideMusic class="mb-3 size-12 opacity-50" />
        <p>No tracks in this playlist yet</p>
      </div>
    </div>

    <!-- Not found -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
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
            Are you sure you want to delete "{{ playlist?.name }}"? This action cannot be undone.
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
