<script setup lang="ts">
import { LucideBarChart3, LucideLibrary, LucidePlay, LucideRefreshCw, LucideImage, LucideAlertTriangle, Info } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { Statistics } from '~/types/stats'
import { formatNumber, formatPlaytime, formatFileSize, formatDate } from '~/helpers/functions'

useTitle('Statistics')
import { surface, toneText } from '~/helpers/ui'

// Hand-authored, not random - a fixed table keeps the twinkle composition balanced and the
// render stable across reloads. [top, left, animationDelay, size]
const PLAYTIME_TWINKLES = [
  ['22%', '18%', '0s', 4],
  ['66%', '30%', '.6s', 3],
  ['30%', '84%', '1.2s', 4],
  ['70%', '74%', '1.8s', 3],
] as const

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
  warn?: boolean
  items: StatItem[]
}

interface StatTile {
  label: string
  value: string
  icon: Component
  link: string
}

const tiles = computed<StatTile[]>(() => {
  const s = stats.value
  if (!s) { return [] }
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
  <div class="flex flex-col gap-8">
    <PageTitle
      text="Statistics"
      :subtext="!loading && stats ? `Last scanned: ${formatDate(stats.lastScanEndedAt)}` : undefined"
    />

    <UiLoadingBlock v-if="loading" />

    <template v-else-if="stats">
      <div
        class="relative overflow-hidden flex flex-col items-center justify-center gap-2.5 px-8 py-10 text-center rounded-xl border border-amber-400/30
          bg-[radial-gradient(120%_160%_at_50%_-30%,color-mix(in_oklch,var(--color-amber-400)_24%,transparent)_0%,transparent_60%),linear-gradient(180deg,var(--color-stone-800)_0%,var(--color-stone-900)_55%,#100f0d_100%)]
          shadow-[0_30px_70px_-35px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,240,210,.07)]"
      >
        <span class="absolute left-1/2 -top-[70%] -translate-x-1/2 w-[130%] aspect-[1.8/1] rounded-[50%] border border-amber-400/25 pointer-events-none" />
        <span class="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(90deg,rgba(255,240,210,.03)_0_1px,transparent_1px_7px)] [mask-image:linear-gradient(180deg,transparent_55%,#000_100%)]" />
        <span
          v-for="([top, left, delay, size], i) in PLAYTIME_TWINKLES"
          :key="i"
          class="absolute rounded-full bg-amber-400
            shadow-[0_0_6px_1px_color-mix(in_oklch,var(--color-amber-400)_70%,transparent)]
            animate-[twinkle_2.6s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60"
          :style="{ top, left, animationDelay: delay, width: `${size}px`, height: `${size}px` }"
        />
        <div class="relative flex items-center justify-center gap-3">
          <span class="h-px w-10 bg-amber-400/30" />
          <span class="text-2xs font-bold uppercase tracking-[0.25em] text-amber-400/70">Total Playtime</span>
          <span class="h-px w-10 bg-amber-400/30" />
        </div>
        <p
          class="relative font-display text-3xl font-bold tracking-[-0.02em] text-center sm:text-4xl
            text-transparent bg-clip-text bg-[length:220%_100%]
            bg-[linear-gradient(100deg,var(--color-stone-50)_35%,#fff_46%,var(--color-amber-400)_50%,var(--color-stone-50)_62%)]
            animate-[shimmer_4.5s_linear_infinite] motion-reduce:animate-none"
        >
          {{ formatPlaytime(stats.playtime) }}
        </p>
      </div>

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
