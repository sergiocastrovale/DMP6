<script setup lang="ts">
import type { SearchRelease } from '~/types/search'
import type { PlaylistSummary } from '~/types/playlist'

const { isStreamMode } = useStreamMode()

const loading = ref(true)
const latestReleases = ref<SearchRelease[]>([])
const recentlyPlayed = ref<SearchRelease[]>([])
const playlists = ref<PlaylistSummary[]>([])
const favoriteReleases = ref<SearchRelease[]>([])

const hasRecentlyPlayed = computed(() => recentlyPlayed.value.length)
const hasPlaylists = computed(() => !isStreamMode.value && playlists.value.length)
const hasFavoriteReleases = computed(() => !isStreamMode.value && favoriteReleases.value.length)

async function loadData() {
  loading.value = true

  try {
    const fetches: Promise<any>[] = [
      $fetch<any[]>('/api/releases/latest?limit=12'),
      $fetch<any[]>('/api/releases/last-played?limit=12'),
    ]

    if (!isStreamMode.value) {
      fetches.push($fetch<PlaylistSummary[]>('/api/playlists'))
      fetches.push($fetch<any>('/api/favorites'))
    }

    const results = await Promise.all(fetches)

    latestReleases.value = results[0]
    recentlyPlayed.value = results[1]

    if (!isStreamMode.value) {
      playlists.value = (results[2] || []).slice(0, 12)
      favoriteReleases.value = (results[3]?.releases || [])
        .slice(0, 12)
        .map((fav: any) => fav.release)
    }
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
    <div v-if="loading" class="flex flex-col gap-12">
      <div v-for="i in 3" :key="i">
        <div class="mb-4 h-6 w-40 animate-pulse rounded bg-zinc-800" />
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <UiReleaseSkeleton v-for="j in 6" :key="j" />
        </div>
      </div>
    </div>

    <div v-else class="flex flex-col gap-12">
      <HomeReleaseGrid
        title="Latest Additions"
        :releases="latestReleases"
        view-more-link="/browse"
      />
      <HomeReleaseGrid
        v-if="hasRecentlyPlayed"
        title="Recently Played"
        :releases="recentlyPlayed"
      />
      <HomePlaylistGrid 
        v-if="hasPlaylists"
        :playlists="playlists"
        @refresh="refreshData"
      />
      <HomeReleaseGrid
        v-if="hasFavoriteReleases"
        title="Favorite Releases"
        :releases="favoriteReleases"
        view-more-link="/favorites"
      />
    </div>
  </div>
</template>
