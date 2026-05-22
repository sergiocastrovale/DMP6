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
      <div class="text-ink0">Loading...</div>
    </div>

    <!-- Stats grid -->
    <div v-else-if="stats" class="flex flex-col gap-8">
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-ink0">
          Library
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <NuxtLink to="/statistics/artists" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideUsers class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.mainArtists) }}</p>
            <p class="text-xs text-ink0">Artists</p>
          </NuxtLink>
          <NuxtLink to="/statistics/artists" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideUsers class="mb-2 size-5 text-accent/60" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.relatedArtists) }}</p>
            <p class="text-xs text-ink0">Related artists</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideDisc class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.releases) }}</p>
            <p class="text-xs text-ink0">Releases</p>
          </NuxtLink>
          <NuxtLink to="/statistics/tracks" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideMusic2 class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.tracks) }}</p>
            <p class="text-xs text-ink0">Tracks</p>
          </NuxtLink>
          <NuxtLink to="/statistics/genres" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideTag class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.genres) }}</p>
            <p class="text-xs text-ink0">Genres</p>
          </NuxtLink>
        </div>
      </section>

      <!-- Playback -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-ink0">
          Playback
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/plays" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucidePlay class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.plays) }}</p>
            <p class="text-xs text-ink0">Total Plays</p>
          </NuxtLink>
          <div class="rounded-lg border border-rule bg-bg-1 p-4">
            <LucideClock class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatPlaytime(stats.playtime) }}</p>
            <p class="text-xs text-ink0">Total Playtime</p>
          </div>
        </div>
      </section>

      <!-- Sync -->
      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-ink0">
          MusicBrainz Sync
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/artists-synced" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideRefreshCw class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.artistsSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-ink0">Artists Synced</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases-synced" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideRefreshCw class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.releasesSyncedWithMusicbrainz) }}</p>
            <p class="text-xs text-ink0">Releases Synced</p>
          </NuxtLink>
        </div>
      </section>

      <section>
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-ink0">
          Cover Art
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NuxtLink to="/statistics/artists-with-art" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideImage class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.artistsWithCoverArt) }}</p>
            <p class="text-xs text-ink0">Artists with photo</p>
          </NuxtLink>
          <NuxtLink to="/statistics/releases-with-art" class="rounded-lg border border-rule bg-bg-1 p-4 transition-colors hover:border-rule hover:bg-bg-2">
            <LucideImage class="mb-2 size-5 text-accent" />
            <p class="text-2xl font-bold text-ink">{{ formatNumber(stats.releasesWithCoverArt) }}</p>
            <p class="text-xs text-ink0">Releases with cover art</p>
          </NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>
