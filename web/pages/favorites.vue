<script setup lang="ts">
import { LucideHeart, Loader2 } from 'lucide-vue-next'
import type { FavoritesResponse, FavoriteRelease, FavoriteTrack } from '~/types/favorites'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const loadingMore = ref(false)
const releases = ref<FavoriteRelease[]>([])
const tracks = ref<FavoriteTrack[]>([])
const totalReleases = ref(0)
const totalTracks = ref(0)
const hasMoreReleases = ref(false)
const hasMoreTracks = ref(false)
const releasePage = ref(1)
const trackPage = ref(1)
const activeTab = ref<'releases' | 'tracks'>((route.query.tab as 'releases' | 'tracks') || 'releases')
const PAGE_SIZE = 50

const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

const fetchReleases = async (page: number) => {
  const data = await $fetch<FavoritesResponse>('/api/favorites', {
    query: { type: 'releases', page, pageSize: PAGE_SIZE },
  })
  releases.value.push(...data.releases)
  totalReleases.value = data.totalReleases
  hasMoreReleases.value = data.hasMoreReleases
  releasePage.value = page
}

const fetchTracks = async (page: number) => {
  const data = await $fetch<FavoritesResponse>('/api/favorites', {
    query: { type: 'tracks', page, pageSize: PAGE_SIZE },
  })
  tracks.value.push(...data.tracks)
  totalTracks.value = data.totalTracks
  hasMoreTracks.value = data.hasMoreTracks
  trackPage.value = page
}

onMounted(async () => {
  const targetPage = Math.max(1, Number(route.query.page) || 1)
  try {
    const initial = await $fetch<FavoritesResponse>('/api/favorites', {
      query: { type: 'all', page: 1, pageSize: PAGE_SIZE },
    })
    releases.value = initial.releases
    tracks.value = initial.tracks
    totalReleases.value = initial.totalReleases
    totalTracks.value = initial.totalTracks
    hasMoreReleases.value = initial.hasMoreReleases
    hasMoreTracks.value = initial.hasMoreTracks

    for (let p = 2; p <= targetPage; p++) {
      if (activeTab.value === 'releases' && hasMoreReleases.value) {
        await fetchReleases(p)
      } else if (activeTab.value === 'tracks' && hasMoreTracks.value) {
        await fetchTracks(p)
      }
    }
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
  }

  nextTick(() => {
    observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !loadingMore.value) {
        loadMore()
      }
    }, { rootMargin: '400px' })
    if (sentinel.value) { observer.observe(sentinel.value) }
  })
})

onUnmounted(() => observer?.disconnect())

const loadMore = async () => {
  if (loadingMore.value) { return }
  const hasMore = activeTab.value === 'releases' ? hasMoreReleases.value : hasMoreTracks.value
  if (!hasMore) { return }

  loadingMore.value = true
  try {
    const next = activeTab.value === 'releases' ? releasePage.value + 1 : trackPage.value + 1
    activeTab.value === 'releases' ? await fetchReleases(next) : await fetchTracks(next)
    router.replace({ query: { ...route.query, page: String(next) } })
  }
  catch { /* ignore */ }
  finally {
    loadingMore.value = false
  }
}

const switchTab = (tab: 'releases' | 'tracks') => {
  activeTab.value = tab
  router.replace({ query: { ...route.query, tab, page: undefined } })
}

const unfavoriteRelease = async (releaseId: string) => {
  try {
    await $fetch(`/api/favorites/releases/${releaseId}`, { method: 'DELETE' })
    releases.value = releases.value.filter(r => r.release.id !== releaseId)
    totalReleases.value--
  }
  catch { /* ignore */ }
}

const unfavoriteTrack = async (trackId: string) => {
  try {
    await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
    tracks.value = tracks.value.filter(t => t.track.id !== trackId)
    totalTracks.value--
  }
  catch { /* ignore */ }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-zinc-50">
        <LucideHeart class="inline size-6 -mt-1 text-amber-500" />
        Favorites
      </h1>
      <p class="mt-1 text-sm text-zinc-500">
        Your favorite releases and tracks
      </p>
    </div>

    <div class="flex gap-2 border-b border-zinc-800">
      <button
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activeTab === 'releases' ? 'border-b-2 border-amber-500 text-amber-500' : 'text-zinc-400 hover:text-zinc-50'"
        @click="switchTab('releases')"
      >
        Releases ({{ totalReleases }})
      </button>
      <button
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activeTab === 'tracks' ? 'border-b-2 border-amber-500 text-amber-500' : 'text-zinc-400 hover:text-zinc-50'"
        @click="switchTab('tracks')"
      >
        Tracks ({{ totalTracks }})
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <div v-else>
      <FavoritesReleaseGrid
        v-if="activeTab === 'releases'"
        :releases="releases"
        @unfavorite="unfavoriteRelease"
      />
      <FavoritesTrackTable
        v-if="activeTab === 'tracks'"
        :tracks="tracks"
        @unfavorite="unfavoriteTrack"
      />

      <div ref="sentinel" class="h-1" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <Loader2 :size="20" class="animate-spin text-zinc-500" />
      </div>
    </div>
  </div>
</template>
