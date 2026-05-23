<script setup lang="ts">
import { LucideHeart, LucideDisc, Loader2 } from 'lucide-vue-next'
import type { FavoritesResponse, FavoriteRelease, FavoriteTrack } from '~/types/favorites'

const route = useRoute()
const router = useRouter()
const { releaseImage } = useImageUrl()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')

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

watch(activeTab, (tab) => {
  router.replace({ query: { ...route.query, tab, page: undefined } })
})

const favTabs = computed(() => [
  { key: 'releases', label: 'Releases', count: totalReleases.value },
  { key: 'tracks', label: 'Tracks', count: totalTracks.value },
])

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
    <PageTitle :icon="LucideHeart" text="Favorites" subtext="Your favorite releases and tracks" />

    <Tabs v-model="activeTab" :tabs="favTabs" />

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>

    <div v-else>
      <div v-if="activeTab === 'releases'">
        <div
          v-if="releases.length > 0"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
          <Block
            v-for="fav in releases"
            :key="fav.id"
            :id="fav.release.id"
            :title="fav.release.title"
            :title-link="`/artist/${fav.release.artist!.slug}?releaseId=${fav.release.id}`"
            :subtitle="fav.release.artist!.name"
            :subtitle-link="`/artist/${fav.release.artist!.slug}`"
            :year="fav.release.year"
            :image="releaseImage(fav.release)"
            playable
            :release-id="fav.release.id"
            :artist-slug="fav.release.artist!.slug"
          >
            <template v-if="canCrud" #overlay>
              <button
                class="absolute right-2 top-2 z-10 rounded-full bg-bg-1/90 p-1.5 text-accent opacity-0 transition-opacity group-hover:opacity-100"
                @click.stop="unfavoriteRelease(fav.release.id)"
              >
                <LucideHeart class="size-4" fill="currentColor" />
              </button>
            </template>
          </Block>
        </div>
        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
          <LucideDisc class="mb-3 size-12 opacity-50" />
          <p>No favorite releases yet</p>
          <NuxtLink to="/browse" class="mt-4 text-sm text-accent hover:text-accent transition-colors">
            Browse releases
          </NuxtLink>
        </div>
      </div>
      <FavoritesTrackTable
        v-if="activeTab === 'tracks'"
        :tracks="tracks"
        @unfavorite="unfavoriteTrack"
      />

      <div ref="sentinel" class="h-1" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <Loader2 :size="20" class="animate-spin text-ink0" />
      </div>
    </div>
  </div>
</template>
