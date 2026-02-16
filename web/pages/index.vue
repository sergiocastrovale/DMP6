<script setup lang="ts">
import type { SearchRelease } from '~/types/search'
import type { PlaylistSummary } from '~/types/playlist'

const loading = ref(true)
const latestReleases = ref<SearchRelease[]>([])
const recentlyPlayed = ref<SearchRelease[]>([])
const playlists = ref<PlaylistSummary[]>([])
const favoriteReleases = ref<SearchRelease[]>([])

async function loadData() {
  loading.value = true

  try {
    const [latestData, recentData, playlistsData, favoritesData] = await Promise.all([
      $fetch<any[]>('/api/releases/latest?limit=12'),
      $fetch<any[]>('/api/releases/last-played?limit=12'),
      $fetch<PlaylistSummary[]>('/api/playlists'),
      $fetch<any>('/api/favorites'),
    ])

    latestReleases.value = latestData
    recentlyPlayed.value = recentData
    playlists.value = playlistsData.slice(0, 12) // Max 12 for home page
    favoriteReleases.value = favoritesData.releases
      .slice(0, 12)
      .map((fav: any) => fav.release)
  }
  catch (error) {
    console.error('Failed to load home page data:', error)
  }
  finally {
    loading.value = false
  }
}

function refreshData() {
  loadData()
}

// Load data on mount
onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="flex flex-col gap-12">
    <div>
      <h1 class="text-2xl font-bold text-zinc-50">
        Home
      </h1>
      <p class="mt-1 text-sm text-zinc-500">
        Welcome back to your music library
      </p>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="flex flex-col gap-12">
      <div v-for="i in 3" :key="i">
        <div class="mb-4 h-6 w-40 animate-pulse rounded bg-zinc-800" />
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <UiReleaseSkeleton v-for="j in 6" :key="j" />
        </div>
      </div>
    </div>

    <!-- Content -->
    <div v-else class="flex flex-col gap-12">
      <!-- Latest additions -->
      <HomeReleaseGrid
        title="Latest Additions"
        :releases="latestReleases"
        view-more-link="/browse"
        empty-message="No releases indexed yet"
      />

      <!-- Recently played -->
      <HomeReleaseGrid
        title="Recently Played"
        :releases="recentlyPlayed"
        empty-message="No plays recorded yet"
      />

      <!-- Playlists -->
      <HomePlaylistGrid
        :playlists="playlists"
        @refresh="refreshData"
      />

      <!-- Favorite releases -->
      <HomeReleaseGrid
        title="Favorite Releases"
        :releases="favoriteReleases"
        view-more-link="/favorites"
        empty-message="No favorite releases yet"
      />
    </div>
  </div>
</template>
