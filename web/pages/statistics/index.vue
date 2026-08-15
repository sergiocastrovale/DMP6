<script setup lang="ts">
import { LucideBarChart3, LucideLibrary, LucidePlay, LucideRefreshCw, LucideImage, LucideSearch, Info } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { Statistics } from '~/types/stats'
import { formatNumber, formatPlaytime, formatFileSize, formatDate } from '~/helpers/functions'

const NuxtLink = resolveComponent('NuxtLink')

definePageMeta({ layout: 'admin' })

const loading = ref(true)
const stats = ref<Statistics | null>(null)

interface StatItem {
  label: string
  value: string
  link?: string
  info?: string
}

interface StatSection {
  title: string
  icon: Component
  items: StatItem[]
}

const sections = computed<StatSection[]>(() => {
  const s = stats.value
  if (!s) { return [] }
  return [
    {
      title: 'Library',
      icon: LucideLibrary,
      items: [
        { label: 'Artists', value: formatNumber(s.mainArtists), link: '/statistics/artists' },
        { label: 'Linked artists', value: formatNumber(s.linkedArtists), info: 'Artists that share a MusicBrainz ID with another artist (e.g. "Artist A & B" → "Artist A"). Their catalogue is aggregated on the primary artist\'s page.' },
        { label: 'Releases', value: formatNumber(s.releases), link: '/statistics/releases' },
        { label: 'Tracks', value: formatNumber(s.tracks), link: '/statistics/tracks' },
        { label: 'Genres', value: formatNumber(s.genres), link: '/statistics/genres' },
        { label: 'Total size', value: formatFileSize(s.totalFileSize), link: '/statistics/size' },
      ],
    },
    {
      title: 'Playback',
      icon: LucidePlay,
      items: [
        { label: 'Total plays', value: formatNumber(s.plays), link: '/statistics/plays' },
        { label: 'Total playtime', value: formatPlaytime(s.playtime) },
      ],
    },
    {
      title: 'MusicBrainz Sync',
      icon: LucideRefreshCw,
      items: [
        { label: 'Artists synced', value: formatNumber(s.artistsSyncedWithMusicbrainz), link: '/statistics/artists-synced' },
        { label: 'Releases synced', value: formatNumber(s.releasesSyncedWithMusicbrainz), link: '/statistics/releases-synced' },
      ],
    },
    {
      title: 'Cover Art',
      icon: LucideImage,
      items: [
        { label: 'Artists with photo', value: formatNumber(s.artistsWithCoverArt), link: '/statistics/artists-with-art' },
        { label: 'Releases with cover art', value: formatNumber(s.releasesWithCoverArt), link: '/statistics/releases-with-art' },
      ],
    },
    {
      title: 'Curation',
      icon: LucideSearch,
      items: [
        { label: 'Unmatched releases', value: formatNumber(s.unmatchedReleases), link: '/statistics/unmatched' },
        { label: 'Incomplete releases', value: formatNumber(s.incompleteReleases), link: '/statistics/incomplete' },
        { label: 'Low bitrate tracks', value: formatNumber(s.lowBitrateTracks), link: '/statistics/bitrate' },
        { label: 'Single-release artists', value: formatNumber(s.singleReleaseArtists), link: '/statistics/single-release' },
        { label: 'Shortest releases', value: 'Browse', link: '/statistics/shortest' },
        { label: 'Missing cover art', value: formatNumber(s.missingArtReleases), link: '/statistics/missing-art' },
      ],
    },
  ]
})

const loadStats = async () => {
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

    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-ink-3">Loading...</div>
    </div>

    <div v-else-if="stats" class="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <section v-for="section in sections" :key="section.title" class="rounded-lg border border-rule bg-bg-1 p-5">
        <h2 class="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-3">
          <component :is="section.icon" class="size-4 text-accent" />
          {{ section.title }}
        </h2>
        <div class="flex flex-col gap-3">
          <component
            :is="item.link ? NuxtLink : 'div'"
            v-for="item in section.items"
            :key="item.label"
            :to="item.link"
            class="flex items-baseline justify-between px-2 py-1"
            :class="item.link ? 'rounded transition-colors hover:bg-bg-2' : ''"
          >
            <span class="flex items-center gap-1 text-sm text-ink-3">
              {{ item.label }}
              <Popover v-if="item.info" trigger="hover">
                <template #trigger>
                  <Info :size="13" class="text-ink-3/50 transition-colors hover:text-accent" />
                </template>
                <template #content>
                  <div class="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
                    <p class="text-xs text-ink-2">{{ item.info }}</p>
                  </div>
                </template>
              </Popover>
            </span>
            <span class="text-lg font-bold text-ink">{{ item.value }}</span>
          </component>
        </div>
      </section>
    </div>
  </div>
</template>
