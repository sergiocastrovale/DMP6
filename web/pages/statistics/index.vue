<script setup lang="ts">
import { LucideLibrary, LucidePlay, LucideRefreshCw, LucideImage, LucideAlertTriangle, Info } from 'lucide-vue-next'
import type { Statistics, StatSection, StatTile } from '~/types/stats'
import { formatNumber, formatFileSize, formatDate } from '~/helpers/functions'
import { layout, surface, toneText } from '~/helpers/ui'

useTitle('Statistics')

const NuxtLink = resolveComponent('NuxtLink')

definePageMeta({ layout: 'admin' })

const loading = ref(true)
const stats = ref<Statistics | null>(null)

const tiles = computed<StatTile[]>(() => {
  const s = stats.value
  
  if (!s) { 
    return []
  }

  return [
    { label: 'Artists', value: formatNumber(s.mainArtists), icon: LucideLibrary, link: '/statistics/artists' },
    { label: 'Releases', value: formatNumber(s.releases), icon: LucideImage, link: '/statistics/releases' },
    { label: 'Tracks', value: formatNumber(s.tracks), icon: LucideRefreshCw, link: '/statistics/tracks' },
    { label: 'Total plays', value: formatNumber(s.plays), icon: LucidePlay, link: '/statistics/plays' },
  ]
})

const sections = computed<StatSection[]>(() => {
  const s = stats.value
  if (!s) { return [] }
  return [
    {
      title: 'Library',
      icon: LucideLibrary,
      items: [
        { label: 'Linked artists', value: formatNumber(s.linkedArtists), info: 'Artists that share a MusicBrainz ID with another artist (e.g. "Artist A & B" → "Artist A"). Their catalogue is aggregated on the primary artist\'s page.' },
        { label: 'Genres', value: formatNumber(s.genres), link: '/statistics/genres' },
        { label: 'Total size', value: formatFileSize(s.totalFileSize), link: '/statistics/size' },
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
      icon: LucideAlertTriangle,
      warn: true,
      items: [
        { label: 'Unmatched releases', value: formatNumber(s.unmatchedReleases), link: '/statistics/unmatched' },
        { label: 'Incomplete releases', value: formatNumber(s.incompleteReleases), link: '/statistics/incomplete' },
        { label: 'Low bitrate tracks', value: formatNumber(s.lowBitrateTracks), link: '/statistics/bitrate' },
        { label: 'Single-release artists', value: formatNumber(s.singleReleaseArtists), link: '/statistics/single-release' },
        { label: 'Missing cover art', value: formatNumber(s.missingArtReleases), link: '/statistics/missing-art' },
        { label: 'Shortest releases', value: 'Browse', link: '/statistics/shortest' },
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
  <div :class="layout.page">
    <PageTitle
      text="Statistics"
      :subtext="!loading && stats ? `Last scanned: ${formatDate(stats.lastScanEndedAt)}` : undefined"
    />

    <UiLoadingBlock v-if="loading" />

    <template v-else-if="stats">
      <StatisticsPlaytime :stats="stats" />

      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NuxtLink
          v-for="tile in tiles"
          :key="tile.label"
          :to="tile.link"
          :class="[surface.card, 'flex flex-col gap-3 p-5 transition-colors duration-150 hover:border-stone-100/15']"
        >
          <component :is="tile.icon" class="size-5 text-amber-400" />
          <div>
            <p class="font-display text-2xl font-bold text-stone-100 tabular-nums">{{ tile.value }}</p>
            <p class="text-sm text-stone-100/55">{{ tile.label }}</p>
          </div>
        </NuxtLink>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section v-for="section in sections" :key="section.title" :class="surface.card">
          <h2
            :class="[surface.cardHead, section.warn ? toneText.warning : 'text-stone-100/55', 'text-2xs font-bold uppercase tracking-[0.1em]']"
          >
            <component :is="section.icon" :class="['size-4', section.warn ? toneText.warning : 'text-amber-400']" />
            {{ section.title }}
          </h2>
          <div class="flex flex-col">
            <component
              :is="item.link ? NuxtLink : 'div'"
              v-for="item in section.items"
              :key="item.label"
              :to="item.link"
              class="flex items-baseline justify-between px-[18px] py-3 border-b border-stone-100/6 last:border-b-0"
              :class="item.link ? 'transition-colors duration-150 hover:bg-stone-800/50' : ''"
            >
              <span class="flex items-center gap-1.5 text-base text-stone-100/60">
                {{ item.label }}
                <Popover v-if="item.info" trigger="hover">
                  <template #trigger>
                    <Info :size="13" class="text-stone-100/50 transition-colors duration-150 hover:text-amber-400" />
                  </template>
                  <template #content>
                    <div :class="[surface.popover, 'absolute left-0 top-full z-20 mt-1 w-64 p-3']">
                      <p class="text-sm text-stone-100/60">{{ item.info }}</p>
                    </div>
                  </template>
                </Popover>
              </span>
              <span class="text-lg font-bold tabular-nums" :class="item.link && item.value === 'Browse' ? toneText.warning : 'text-stone-100'">{{ item.value }}</span>
            </component>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
