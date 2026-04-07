<script setup lang="ts">
import { LucideListMusic, LucidePlus, LucideSparkles } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

const loading = ref(true)
const playlists = ref<PlaylistSummary[]>([])
const showCreate = ref(false)

const genrePlaylists = computed(() => playlists.value.filter(p => p.type === 'GENRE'))
const manualPlaylists = computed(() => playlists.value.filter(p => p.type === 'MANUAL'))

async function loadPlaylists() {
  loading.value = true
  try {
    playlists.value = await $fetch<PlaylistSummary[]>('/api/playlists')
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => loadPlaylists())
</script>

<template>
  <div class="flex flex-col gap-6">
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
        @click="showCreate = true"
      >
        <LucidePlus class="inline size-4 -mt-0.5" />
        New Playlist
      </button>
    </div>

    <UiLoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />

    <template v-else>
      <div v-if="manualPlaylists.length > 0" class="flex flex-col gap-4">
        <h2 v-if="genrePlaylists.length > 0" class="text-lg font-semibold text-zinc-50">
          Your Playlists
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <PlaylistBlock
            v-for="playlist in manualPlaylists"
            :key="playlist.id"
            :playlist="playlist"
          />
        </div>
      </div>

      <div v-if="genrePlaylists.length > 0" class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <LucideSparkles class="size-4 text-amber-500" />
            <h2 class="text-lg font-semibold text-zinc-50">
              Genre Playlists
            </h2>
            <span class="text-xs text-zinc-500">Auto-generated</span>
            <PlaylistGenreInfoPopover />
          </div>
          <PlaylistRegenerateButton />
        </div>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <PlaylistBlock
            v-for="playlist in genrePlaylists"
            :key="playlist.id"
            :playlist="playlist"
          />
        </div>
      </div>

      <div
        v-if="playlists.length === 0"
        class="flex flex-col items-center justify-center py-20 text-center text-zinc-500"
      >
        <LucideListMusic class="mb-3 size-12 opacity-50" />
        <p>No playlists yet</p>
        <button
          class="mt-4 text-sm text-amber-500 hover:text-amber-600 transition-colors"
          @click="showCreate = true"
        >
          Create your first playlist
        </button>
      </div>
    </template>

    <PlaylistCreateDialog v-model="showCreate" @created="loadPlaylists" />
  </div>
</template>
