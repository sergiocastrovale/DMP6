<template>
  <div
    v-if="loading || playlists.length > 0"
    class="flex flex-col gap-8"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-ink">
        Your Playlists
      </h2>
      <div class="flex items-center gap-2">
        <button
          class="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent transition-colors"
          @click="showCreate = true"
        >
          <LucidePlus class="inline size-4 -mt-0.5" />
          New Playlist
        </button>
        <NuxtLink
          to="/playlists"
          class="text-sm text-accent hover:text-accent transition-colors"
        >
          View all
        </NuxtLink>
      </div>
    </div>

    <LoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />
    <div
      v-else-if="playlists.length > 0"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <PlaylistBlock
        v-for="playlist in playlists"
        :key="playlist.id"
        :playlist="playlist"
      />
    </div>

    <div
      v-else-if="!loading"
      class="flex flex-col items-center justify-center py-12 text-center text-ink0"
    >
      <LucideListMusic class="mb-3 size-12 opacity-50" />
      <p>No playlists yet</p>
      <button
        class="mt-4 text-sm text-accent hover:text-accent transition-colors"
        @click="showCreate = true"
      >
        Create your first playlist
      </button>
    </div>

    <PlaylistCreateDialog v-model="showCreate" @created="emit('refresh')" />
  </div>
</template>

<script setup lang="ts">
import { LucidePlus, LucideListMusic } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

withDefaults(defineProps<{
  playlists: PlaylistSummary[]
  loading?: boolean
}>(), {
  loading: false,
})

const emit = defineEmits<{ refresh: [] }>()

const showCreate = ref(false)
</script>
