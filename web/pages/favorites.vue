<script setup lang="ts">
import { LucideHeart, LucideDisc, LucideMusic } from 'lucide-vue-next'
import type { FavoritesResponse } from '~/types/favorites'

const { isStreamMode } = useStreamMode()
if (isStreamMode.value) {
  navigateTo('/')
}

const loading = ref(true)
const favorites = ref<FavoritesResponse | null>(null)
const activeTab = ref<'releases' | 'tracks'>('releases')

async function loadFavorites() {
  loading.value = true
  try {
    const data = await $fetch<FavoritesResponse>('/api/favorites')
    favorites.value = data
  }
  catch (error) {
    console.error('Failed to load favorites:', error)
  }
  finally {
    loading.value = false
  }
}

async function unfavoriteRelease(releaseId: string) {
  try {
    await $fetch(`/api/favorites/releases/${releaseId}`, { method: 'DELETE' })
    await loadFavorites()
  }
  catch (error) {
    console.error('Failed to unfavorite release:', error)
  }
}

async function unfavoriteTrack(trackId: string) {
  try {
    await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
    await loadFavorites()
  }
  catch (error) {
    console.error('Failed to unfavorite track:', error)
  }
}

const { releaseImage } = useImageUrl()
const playerStore = usePlayerStore()

function formatDuration(seconds: number | null) {
  if (!seconds)
    return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

async function playRelease(releaseId: string) {
  try {
    const { data } = await useFetch<any>(`/api/releases/${releaseId}/tracks`)
    if (data.value && data.value.length > 0) {
      playerStore.playTrack(data.value[0], data.value)
    }
  }
  catch (error) {
    console.error('Failed to load release tracks:', error)
  }
}

function playTrack(track: any) {
  playerStore.playTrack(track, [track])
}

onMounted(() => {
  loadFavorites()
})
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
        @click="activeTab = 'releases'"
      >
        Releases ({{ favorites?.releases.length || 0 }})
      </button>
      <button
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activeTab === 'tracks' ? 'border-b-2 border-amber-500 text-amber-500' : 'text-zinc-400 hover:text-zinc-50'"
        @click="activeTab = 'tracks'"
      >
        Tracks ({{ favorites?.tracks.length || 0 }})
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">
        Loading...
      </div>
    </div>

    <!-- Content -->
    <div v-else>
      <!-- Releases tab -->
      <div v-if="activeTab === 'releases'">
        <div
          v-if="favorites && favorites.releases.length > 0"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
          <div
            v-for="fav in favorites.releases"
            :key="fav.id"
            class="group relative flex flex-col gap-2"
          >
            <!-- Unfavorite button -->
            <button
              class="absolute right-2 top-2 z-10 rounded-full bg-zinc-900/90 p-1.5 text-amber-500 opacity-0 transition-opacity group-hover:opacity-100"
              @click="unfavoriteRelease(fav.release.id)"
            >
              <LucideHeart class="size-4" fill="currentColor" />
            </button>

            <!-- Cover art with play button -->
            <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
              <img
                v-if="releaseImage(fav.release)"
                :src="releaseImage(fav.release)!"
                :alt="fav.release.title"
                class="h-full w-full object-cover transition-transform group-hover:scale-105"
              >
              <div
                v-else
                class="flex h-full w-full items-center justify-center text-zinc-600"
              >
                <LucideDisc class="size-12" />
              </div>

              <!-- Play button overlay -->
              <button
                class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                @click="playRelease(fav.release.id)"
              >
                <div class="rounded-full bg-amber-500 p-3 text-zinc-950 shadow-lg">
                  <LucideMusic class="size-6" />
                </div>
              </button>
            </div>

            <!-- Release info -->
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

        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
          <LucideDisc class="mb-3 size-12 opacity-50" />
          <p>No favorite releases yet</p>
          <NuxtLink
            to="/browse"
            class="mt-4 text-sm text-amber-500 hover:text-amber-600 transition-colors"
          >
            Browse releases
          </NuxtLink>
        </div>
      </div>

      <!-- Tracks tab -->
      <div v-if="activeTab === 'tracks'">
        <div v-if="favorites && favorites.tracks.length > 0" class="rounded-lg border border-zinc-800 bg-zinc-900">
          <div
            v-for="(fav, idx) in favorites.tracks"
            :key="fav.id"
            class="group flex items-center gap-3 border-b border-zinc-800 p-3 last:border-b-0 hover:bg-zinc-800/50 transition-colors"
          >
            <!-- Track number / play button -->
            <button
              class="flex size-10 flex-shrink-0 items-center justify-center text-sm text-zinc-500 group-hover:text-amber-500"
              @click="playTrack(fav.track)"
            >
              <span class="group-hover:hidden">{{ idx + 1 }}</span>
              <LucideMusic class="hidden size-4 group-hover:block" />
            </button>

            <!-- Cover art -->
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

            <!-- Track info -->
            <div class="flex-1 overflow-hidden">
              <p class="truncate text-sm font-medium text-zinc-50">
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
                <span class="text-zinc-600">•</span>
                <span>{{ fav.track.release.title }}</span>
              </div>
            </div>

            <!-- Duration -->
            <span class="text-xs text-zinc-500">
              {{ formatDuration(fav.track.duration) }}
            </span>

            <!-- Unfavorite button -->
            <button
              class="rounded-full p-1.5 text-amber-500 opacity-0 transition-opacity group-hover:opacity-100"
              @click="unfavoriteTrack(fav.track.id)"
            >
              <LucideHeart class="size-4" fill="currentColor" />
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
          <LucideMusic class="mb-3 size-12 opacity-50" />
          <p>No favorite tracks yet</p>
        </div>
      </div>
    </div>
  </div>
</template>
