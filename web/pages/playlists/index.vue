<script setup lang="ts">
import { LucideListMusic, LucidePlus, LucideMusic } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'

const { isStreamMode } = useStreamMode()
if (isStreamMode.value) {
  navigateTo('/')
}

const loading = ref(true)
const playlists = ref<PlaylistSummary[]>([])
const showCreateDialog = ref(false)
const newPlaylistName = ref('')
const newPlaylistDescription = ref('')
const creating = ref(false)

const { resolve } = useImageUrl()

async function loadPlaylists() {
  loading.value = true
  try {
    const data = await $fetch<PlaylistSummary[]>('/api/playlists')
    playlists.value = data
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
  finally {
    loading.value = false
  }
}

function coverImageUrl(cover: { image: string | null; imageUrl: string | null }) {
  return resolve(cover.image, cover.imageUrl, 'releases')
}

async function createPlaylist() {
  if (!newPlaylistName.value.trim() || creating.value)
    return

  creating.value = true
  try {
    await $fetch('/api/playlists', {
      method: 'POST',
      body: {
        name: newPlaylistName.value.trim(),
        description: newPlaylistDescription.value.trim() || undefined,
      },
    })

    // Reset form
    newPlaylistName.value = ''
    newPlaylistDescription.value = ''
    showCreateDialog.value = false

    // Reload playlists
    await loadPlaylists()
  }
  catch (error) {
    console.error('Failed to create playlist:', error)
    alert('Failed to create playlist')
  }
  finally {
    creating.value = false
  }
}

onMounted(() => {
  loadPlaylists()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-zinc-50">
          <LucideListMusic class="inline size-6 -mt-1 text-amber-500" />
          Playlists
        </h1>
        <p class="mt-1 text-sm text-zinc-500">
          Your custom playlists
        </p>
      </div>
      <button
        class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
        @click="showCreateDialog = true"
      >
        <LucidePlus class="inline size-4 -mt-0.5" />
        New Playlist
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">
        Loading...
      </div>
    </div>

    <!-- Playlists grid -->
    <div
      v-else-if="playlists.length > 0"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <NuxtLink
        v-for="playlist in playlists"
        :key="playlist.id"
        :to="`/playlists/${playlist.slug}`"
        class="group flex flex-col gap-2"
      >
        <!-- Cover mosaic -->
        <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
          <div
            v-if="playlist.coverImages.length > 0"
            class="grid h-full w-full"
            :class="{
              'grid-cols-1': playlist.coverImages.length === 1,
              'grid-cols-2': playlist.coverImages.length > 1,
            }"
          >
            <div
              v-for="(cover, idx) in playlist.coverImages.slice(0, 4)"
              :key="idx"
              class="relative overflow-hidden bg-zinc-900"
            >
              <img
                v-if="coverImageUrl(cover)"
                :src="coverImageUrl(cover)!"
                :alt="`Cover ${idx + 1}`"
                class="h-full w-full object-cover transition-transform group-hover:scale-105"
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
        <div class="flex flex-col gap-0.5">
          <p class="line-clamp-1 text-sm font-medium text-zinc-50 group-hover:text-amber-500 transition-colors">
            {{ playlist.name }}
          </p>
          <p class="text-xs text-zinc-500">
            {{ playlist.trackCount }} {{ playlist.trackCount === 1 ? 'track' : 'tracks' }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
      <LucideListMusic class="mb-3 size-12 opacity-50" />
      <p>No playlists yet</p>
      <button
        class="mt-4 text-sm text-amber-500 hover:text-amber-600 transition-colors"
        @click="showCreateDialog = true"
      >
        Create your first playlist
      </button>
    </div>

    <!-- Create playlist dialog -->
    <Teleport to="body">
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        @click.self="showCreateDialog = false"
      >
        <div class="w-full max-w-md rounded-lg bg-zinc-900 p-6 shadow-xl">
          <h3 class="mb-4 text-lg font-semibold text-zinc-50">
            Create Playlist
          </h3>
          <form @submit.prevent="createPlaylist">
            <div class="mb-4">
              <label class="mb-1 block text-sm text-zinc-400">Name</label>
              <input
                v-model="newPlaylistName"
                type="text"
                placeholder="My Playlist"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                required
              >
            </div>
            <div class="mb-6">
              <label class="mb-1 block text-sm text-zinc-400">Description (optional)</label>
              <textarea
                v-model="newPlaylistDescription"
                placeholder="Add a description..."
                rows="3"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                @click="showCreateDialog = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
                :disabled="creating"
              >
                {{ creating ? 'Creating...' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
