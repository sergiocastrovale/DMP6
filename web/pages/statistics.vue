<script setup lang="ts">
import { LucideBarChart3, LucideUsers, LucideDisc, LucideMusic2, LucideTag, LucidePlay, LucideClock, LucideRefreshCw, LucideImage } from 'lucide-vue-next'
import type { Statistics } from '~/types/stats'

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

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatPlaytime(seconds: number): string {
  if (seconds === 0) return '0 seconds'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (mins > 0) parts.push(`${mins}m`)
  return parts.join(' ') || '< 1m'
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
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-zinc-50">
        <LucideBarChart3 class="inline size-6 -mt-1 text-amber-500" />
        Statistics
      </h1>
      <p class="mt-1 text-sm text-zinc-500">
        Overview of your music library
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">Loading...</div>
    </div>

    <!-- Stats grid -->
    <div v-else-if="stats" class="flex flex-col gap-8">
      <!-- General -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Library
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideUsers class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.artists) }}</p>
            <p class="text-xs text-zinc-500">Artists</p>
          </div>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideDisc class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releases) }}</p>
            <p class="text-xs text-zinc-500">Releases</p>
          </div>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideMusic2 class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.tracks) }}</p>
            <p class="text-xs text-zinc-500">Tracks</p>
          </div>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideTag class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.genres) }}</p>
            <p class="text-xs text-zinc-500">Genres</p>
          </div>
        </div>
      </section>

      <!-- Playback -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Playback
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucidePlay class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.plays) }}</p>
            <p class="text-xs text-zinc-500">Total Plays</p>
          </div>
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
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideRefreshCw class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.artistsSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-zinc-500">Artists Synced</p>
          </div>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideRefreshCw class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releasesSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-zinc-500">Releases Synced</p>
          </div>
        </div>
      </section>

      <!-- Cover Art -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Cover Art
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideImage class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.artistsWithCoverArt) }}</p>
            <p class="text-xs text-zinc-500">Artists with Art</p>
          </div>
          <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <LucideImage class="mb-2 size-5 text-amber-500" />
            <p class="text-2xl font-bold text-zinc-50">{{ formatNumber(stats.releasesWithCoverArt) }}</p>
            <p class="text-xs text-zinc-500">Releases with Art</p>
          </div>
        </div>
      </section>

      <!-- Last Scan -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Last Scan
        </h2>
        <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between">
              <span class="text-zinc-400">Started</span>
              <span class="text-zinc-50">{{ formatDate(stats.lastScanStartedAt) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-zinc-400">Ended</span>
              <span class="text-zinc-50">{{ formatDate(stats.lastScanEndedAt) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- No stats -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
      <LucideBarChart3 class="mb-3 size-12 opacity-50" />
      <p>No statistics available</p>
    </div>
  </div>
</template>
