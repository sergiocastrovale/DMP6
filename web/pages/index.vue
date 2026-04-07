<script setup lang="ts">
import type { SearchRelease } from '~/types/search'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

const loading = ref(true)
const latest = ref<SearchRelease[]>([])
const recent = ref<SearchRelease[]>([])
const playlists = ref<PlaylistSummary[]>([])
const favorites = ref<SearchRelease[]>([])

const loadData = async () => {
  loading.value = true

  try {
    const [latestData, recentlyPlayedData, playlistData, favoritesData] = await Promise.all([
      $fetch<SearchRelease[]>(`/api/releases/latest?limit=${SKELETON_GRID_SIZE}`),
      $fetch<SearchRelease[]>(`/api/releases/last-played?limit=${SKELETON_GRID_SIZE}`),
      $fetch<PlaylistSummary[]>(`/api/playlists?type=manual&limit=${SKELETON_GRID_SIZE}`),
      $fetch<SearchRelease[]>(`/api/favorites/releases?limit=${SKELETON_GRID_SIZE}`),
    ])

    latest.value = latestData
    recent.value = recentlyPlayedData
    playlists.value = playlistData
    favorites.value = favoritesData
  }
  catch (error) {
    console.error('Failed to load home page data:', error)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="flex flex-col gap-12">
    <ReleaseGrid
      title="Latest Additions"
      :releases="latest"
      :loading="loading"
      view-more-link="/browse"
    />
    <ReleaseGrid
      title="Recently Played"
      :releases="recent"
      :loading="loading"
    />
    <PlaylistGrid
      :playlists="playlists"
      :loading="loading"
      @refresh="loadData"
    />
    <ReleaseGrid
      title="Favorite Releases"
      :releases="favorites"
      :loading="loading"
      view-more-link="/favorites"
    />
  </div>
</template>
