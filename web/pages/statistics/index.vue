<script setup lang="ts">
import { LucideBarChart3, LucideUsers, LucideDisc, LucideMusic2, LucideTag, LucidePlay, LucideClock, LucideRefreshCw, LucideImage } from 'lucide-vue-next'
import type { Statistics } from '~/types/stats'
import { formatNumber, formatPlaytime } from '~/helpers/functions'

definePageMeta({ layout: 'admin' })

const loading = ref(true)
const stats = ref<Statistics | null>(null)

async function loadStats() {
  loading.value = true
  try {
    stats.value = await $fetch<Statistics>('/api/stats')
  }
  catch (error) {
    console.error('Failed to load statistics:', error)
  }
  finally {
    loading.value = false
  }
}


function formatDate(iso: string | null): string {
  if (!iso) {
    return 'Never'
  }

  return new Date(iso).toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <PageTitle
      :icon="LucideBarChart3"
      text="Statistics"
      :subtext="!loading && stats ? `Last scanned: ${formatDate(stats.lastScanEndedAt)}` : undefined"
    />

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">Loading...</div>
    </div>

    <!-- Stats grid -->
    <div v-else-if="stats" class="flex flex-col gap-8">
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Library
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <NuxtLink to="/statistics/artists" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideUsers class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.mainArtists) }}</p>
            <p class="text-xs text-zinc-500">Artists</p>
          </NuxtLink>
          <NuxtLink to="/statistics/artists" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideUsers class="mb-2 size-5 text-amber-500/60" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.relatedArtists) }}</p>
            <p class="text-xs text-zinc-500">Related artists</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideDisc class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releases) }}</p>
            <p class="text-xs text-zinc-500">Releases</p>
          </NuxtLink>
          <NuxtLink to="/statistics/tracks" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideMusic2 class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.tracks) }}</p>
            <p class="text-xs text-zinc-500">Tracks</p>
          </NuxtLink>
          <NuxtLink to="/statistics/genres" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideTag class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.genres) }}</p>
            <p class="text-xs text-zinc-500">Genres</p>
          </NuxtLink>
        </div>
      </section>

      <!-- Playback -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Playback
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/plays" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucidePlay class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.plays) }}</p>
            <p class="text-xs text-zinc-500">Total Plays</p>
          </NuxtLink>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideClock class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatPlaytime(stats.playtime) }}</p>
            <p class="text-xs text-zinc-500">Total Playtime</p>
          </div>
        </div>
      </section>

      <!-- Sync -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          MusicBrainz Sync
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/artists-synced" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideRefreshCw class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.artistsSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-zinc-500">Artists Synced</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases-synced" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideRefreshCw class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releasesSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-zinc-500">Releases Synced</p>
          </NuxtLink>
        </div>
      </section>

      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Cover Art
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/artists-with-art" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideImage class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.artistsWithCoverArt) }}</p>
            <p class="text-xs text-zinc-500">Artists with photo</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases-with-art" class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <LucideImage class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releasesWithCoverArt) }}</p>
            <p class="text-xs text-zinc-500">Releases with cover art</p>
          </NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>
