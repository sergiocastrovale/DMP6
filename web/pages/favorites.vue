<script setup lang="ts">
import { LucideHeart, LucideDisc, LucideMusic, Loader2, LucidePlay, LucidePause } from 'lucide-vue-next'
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

async function fetchReleases(page: number) {
  const data = await $fetch<FavoritesResponse>('/api/favorites', {
    query: { type: 'releases', page, pageSize: PAGE_SIZE },
  })
  releases.value.push(...data.releases)
  totalReleases.value = data.totalReleases
  hasMoreReleases.value = data.hasMoreReleases
  releasePage.value = page
}

async function fetchTracks(page: number) {
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
    // Load both totals on first fetch
    const initial = await $fetch<FavoritesResponse>('/api/favorites', {
      query: { type: 'all', page: 1, pageSize: PAGE_SIZE },
    })
    releases.value = initial.releases
    tracks.value = initial.tracks
    totalReleases.value = initial.totalReleases
    totalTracks.value = initial.totalTracks
    hasMoreReleases.value = initial.hasMoreReleases
    hasMoreTracks.value = initial.hasMoreTracks

    // Load remaining pages if URL specified a deeper page
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
      if (entry.isIntersecting && !loadingMore.value) {
        loadMore()
      }
    }, { rootMargin: '400px' })
    if (sentinel.value) observer.observe(sentinel.value)
  })
})

onUnmounted(() => observer?.disconnect())

async function loadMore() {
  if (loadingMore.value) return

  const hasMore = activeTab.value === 'releases' ? hasMoreReleases.value : hasMoreTracks.value
  if (!hasMore) return

  loadingMore.value = true
  try {
    if (activeTab.value === 'releases') {
      const next = releasePage.value + 1
      await fetchReleases(next)
      router.replace({ query: { ...route.query, page: String(next) } })
    } else {
      const next = trackPage.value + 1
      await fetchTracks(next)
      router.replace({ query: { ...route.query, page: String(next) } })
    }
  }
  catch { /* ignore */ }
  finally {
    loadingMore.value = false
  }
}

function switchTab(tab: 'releases' | 'tracks') {
  activeTab.value = tab
  router.replace({ query: { ...route.query, tab, page: undefined } })
}

async function unfavoriteRelease(releaseId: string) {
  try {
    await $fetch(`/api/favorites/releases/${releaseId}`, { method: 'DELETE' })
    releases.value = releases.value.filter(r => r.release.id !== releaseId)
    totalReleases.value--
  }
  catch { /* ignore */ }
}

async function unfavoriteTrack(trackId: string) {
  try {
    await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
    tracks.value = tracks.value.filter(t => t.track.id !== trackId)
    totalTracks.value--
  }
  catch { /* ignore */ }
}

const { releaseImage } = useImageUrl()
const playerStore = usePlayerStore()

function formatDuration(seconds: number | null) {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function isCurrentRelease(releaseId: string) {
  return playerStore.currentTrack?.localReleaseId === releaseId
}

function isReleasePlaying(releaseId: string) {
  return playerStore.isPlaying && isCurrentRelease(releaseId)
}

async function handleReleaseClick(releaseId: string) {
  if (isCurrentRelease(releaseId)) {
    playerStore.togglePlay()
  }
  else {
    await playRelease(releaseId)
  }
}

async function playRelease(releaseId: string) {
  try {
    const data = await $fetch<any>(`/api/releases/${releaseId}/tracks`)
    if (data?.tracks?.length) {
      const tracks = data.tracks.filter((t: any) => !t.missing).map((t: any) => ({
        id: t.id,
        title: t.title || 'Unknown',
        artist: t.artist || 'Unknown',
        album: t.album || data.release?.title || 'Unknown',
        duration: t.duration || 0,
        artistSlug: data.release?.artistSlug || null,
        releaseImage: data.release?.image ? `/img/releases/${data.release.image}` : null,
        releaseImageUrl: data.release?.imageUrl || null,
        localReleaseId: t.localReleaseId,
      }))
      if (tracks.length) {
        playerStore.setQueue(tracks)
      }
    }
  }
  catch { /* ignore */ }
}

function isCurrentTrack(trackId: string) {
  return playerStore.currentTrack?.id === trackId
}

function isTrackPlaying(trackId: string) {
  return playerStore.isPlaying && isCurrentTrack(trackId)
}

function toPlayerTrack(fav: FavoriteTrack) {
  return {
    id: fav.track.id,
    title: fav.track.title || 'Unknown',
    artist: fav.track.release?.artist?.name || 'Unknown',
    album: fav.track.release?.title || 'Unknown',
    duration: fav.track.duration || 0,
    artistSlug: fav.track.release?.artist?.slug || null,
    releaseImage: fav.track.release?.image ? `/img/releases/${fav.track.release.image}` : null,
    releaseImageUrl: fav.track.release?.imageUrl || null,
    localReleaseId: fav.track.release?.id || null,
  }
}

function handleTrackClick(fav: FavoriteTrack) {
  if (isCurrentTrack(fav.track.id)) {
    playerStore.togglePlay()
  }
  else {
    const playerTracks = tracks.value.map(toPlayerTrack)
    const start = playerTracks.find(t => t.id === fav.track.id)
    playerStore.setQueue(playerTracks, start)
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-zinc-50">
        <LucideHeart class="inline size-6 -mt-1 text-amber-500" />
        Favorites
      </h1>
      <p class="mt-1 text-sm text-zinc-500">
        Your favorite releases and tracks
      </p>
    </div>

    <!-- Tabs -->
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

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <!-- Content -->
    <div v-else>
      <!-- Releases tab -->
      <div v-if="activeTab === 'releases'">
        <div
          v-if="releases.length > 0"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
          <div
            v-for="fav in releases"
            :key="fav.id"
            class="group relative flex flex-col gap-2"
          >
            <button
              class="absolute right-2 top-2 z-10 rounded-full bg-zinc-900/90 p-1.5 text-amber-500 opacity-0 transition-opacity group-hover:opacity-100"
              @click="unfavoriteRelease(fav.release.id)"
            >
              <LucideHeart class="size-4" fill="currentColor" />
            </button>

            <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
              <img
                v-if="releaseImage(fav.release)"
                :src="releaseImage(fav.release)!"
                :alt="fav.release.title"
                class="h-full w-full object-cover transition-transform group-hover:scale-105"
              >
              <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
                <LucideDisc class="size-12" />
              </div>

              <button
                class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity"
                :class="isCurrentRelease(fav.release.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                @click="handleReleaseClick(fav.release.id)"
              >
                <div class="rounded-full bg-amber-500 p-3 text-zinc-950 shadow-lg">
                  <LucidePause v-if="isReleasePlaying(fav.release.id)" class="size-6" fill="currentColor" />
                  <LucidePlay v-else class="size-6" fill="currentColor" />
                </div>
              </button>
            </div>

            <div class="flex flex-col gap-0.5">
              <p class="line-clamp-1 text-sm font-medium text-zinc-50">
                {{ fav.release.title }}
              </p>
              <NuxtLink
                v-if="fav.release.artist"
                :to="`/artist/${fav.release.artist.slug}`"
                class="line-clamp-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                {{ fav.release.artist.name }}
              </NuxtLink>
              <p v-if="fav.release.year" class="text-xs text-zinc-500">
                {{ fav.release.year }}
              </p>
            </div>
          </div>
        </div>

        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
          <LucideDisc class="mb-3 size-12 opacity-50" />
          <p>No favorite releases yet</p>
          <NuxtLink to="/browse" class="mt-4 text-sm text-amber-500 hover:text-amber-600 transition-colors">
            Browse releases
          </NuxtLink>
        </div>
      </div>

      <!-- Tracks tab -->
      <div v-if="activeTab === 'tracks'">
        <Table v-if="tracks.length > 0">
          <TableRow
            v-for="fav in tracks"
            :key="fav.id"
            :active="isCurrentTrack(fav.track.id)"
          >
            <button
              class="flex size-10 shrink-0 items-center justify-center text-sm"
              :class="isCurrentTrack(fav.track.id) ? 'text-amber-500' : 'text-zinc-500 group-hover:text-amber-500'"
              @click="handleTrackClick(fav)"
            >
              <LucidePause v-if="isTrackPlaying(fav.track.id)" :size="16" fill="currentColor" />
              <LucidePlay v-else :size="16" fill="currentColor" />
            </button>

            <div class="relative size-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
              <img
                v-if="fav.track.release && releaseImage(fav.track.release)"
                :src="releaseImage(fav.track.release)!"
                :alt="fav.track.title"
                class="h-full w-full object-cover"
              >
              <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
                <LucideMusic class="size-5" />
              </div>
            </div>

            <div class="flex-1 overflow-hidden">
              <p class="truncate text-sm font-medium" :class="isCurrentTrack(fav.track.id) ? 'text-amber-500' : 'text-zinc-50'">
                {{ fav.track.title }}
              </p>
              <div v-if="fav.track.release" class="flex items-center gap-2 text-xs text-zinc-400">
                <NuxtLink
                  v-if="fav.track.release.artist"
                  :to="`/artist/${fav.track.release.artist.slug}`"
                  class="hover:text-zinc-300 transition-colors"
                >
                  {{ fav.track.release.artist.name }}
                </NuxtLink>
                <span class="text-zinc-600">&bull;</span>
                <span>{{ fav.track.release.title }}</span>
              </div>
            </div>

            <span class="text-xs text-zinc-500">
              {{ formatDuration(fav.track.duration) }}
            </span>

            <button
              class="rounded-full p-1.5 text-amber-500 opacity-0 transition-opacity group-hover:opacity-100"
              @click="unfavoriteTrack(fav.track.id)"
            >
              <LucideHeart class="size-4" fill="currentColor" />
            </button>
          </TableRow>
        </Table>

        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
          <LucideMusic class="mb-3 size-12 opacity-50" />
          <p>No favorite tracks yet</p>
        </div>
      </div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinel" class="h-1" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <Loader2 :size="20" class="animate-spin text-zinc-500" />
      </div>
    </div>
  </div>
</template>
