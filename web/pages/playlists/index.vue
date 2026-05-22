<script setup lang="ts">
import { LucideListMusic, LucidePlus, LucideSparkles } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

const { hasPerm } = useAuth()
const canCrud = hasPerm('playlists.crud')

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
    <PageTitle :icon="LucideListMusic" text="Playlists" subtext="Your custom playlists">
      <button
        v-if="canCrud"
        class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent"
        @click="showCreate = true"
      >
        <LucidePlus class="inline size-4 -mt-0.5" />
        New Playlist
      </button>
    </PageTitle>

    <LoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />

    <template v-else>
      <div v-if="manualPlaylists.length > 0" class="flex flex-col gap-4">
        <h2 v-if="genrePlaylists.length > 0" class="text-lg font-semibold text-ink">
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
            <LucideSparkles class="size-4 text-accent" />
            <h2 class="text-lg font-semibold text-ink">
              Genre Playlists
            </h2>
            <span class="text-xs text-ink0">Auto-generated</span>
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
        class="flex flex-col items-center justify-center py-20 text-center text-ink0"
      >
        <LucideListMusic class="mb-3 size-12 opacity-50" />
        <p>No playlists yet</p>
        <button
          v-if="canCrud"
          class="mt-4 text-sm text-accent hover:text-accent transition-colors"
          @click="showCreate = true"
        >
          Create your first playlist
        </button>
      </div>
    </template>

    <PlaylistCreateDialog v-model="showCreate" @created="loadPlaylists" />
  </div>
</template>
