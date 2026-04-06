<template>
  <div class="flex flex-col gap-8">
    <!-- Section header -->
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-zinc-50">
        Your Playlists
      </h2>
      <div class="flex items-center gap-2">
        <button
          class="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
          @click="showCreateDialog = true"
        >
          <LucidePlus class="inline size-4 -mt-0.5" />
          New Playlist
        </button>
        <NuxtLink
          to="/playlists"
          class="text-sm text-amber-500 hover:text-amber-600 transition-colors"
        >
          View all
        </NuxtLink>
      </div>
    </div>

    <!-- Playlist grid -->
    <div
      v-if="playlists.length > 0"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <template v-for="playlist in playlists" :key="playlist.id">
        <PlaylistBlockGenerated v-if="playlist.type === 'GENRE'" :playlist="playlist" />
        <PlaylistBlock v-else :playlist="playlist" />
      </template>
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-12 text-center text-zinc-500"
    >
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

<script setup lang="ts">
import { LucidePlus, LucideListMusic } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'

defineProps<{
  playlists: PlaylistSummary[]
}>()

const emit = defineEmits<{
  refresh: []
}>()

const showCreateDialog = ref(false)
const newPlaylistName = ref('')
const newPlaylistDescription = ref('')
const creating = ref(false)

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

    newPlaylistName.value = ''
    newPlaylistDescription.value = ''
    showCreateDialog.value = false
    emit('refresh')
  }
  catch (error) {
    console.error('Failed to create playlist:', error)
    alert('Failed to create playlist')
  }
  finally {
    creating.value = false
  }
}
</script>
