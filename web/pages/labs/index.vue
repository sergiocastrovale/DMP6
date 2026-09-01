<script setup lang="ts">
import type { Lab } from '~/types/labs'
import { useGlobalStore } from '~/stores/global'
import { cx, outlinePill, toneBg, typography } from '~/helpers/ui'

useTitle('Labs')

definePageMeta({ layout: 'labs' })

const global = useGlobalStore()

// Each experiment says how much to trust it. A force graph you can drag into a knot and a mosaic
// that has run against the whole library are not the same promise, and the card is the only place
// that difference is visible before you click.
const labs = computed<Lab[]>(() => [
  {
    to: '/labs/mosaic',
    title: 'Album Mosaic',
    // The count is dropped until app-stats has actually loaded - on first paint it is 0, and
    // "Stitches 0 covers" reads as a broken feature rather than a pending fetch.
    description: `Stitches ${global.stats.releases > 0 ? `${global.stats.releases.toLocaleString()} covers` : 'every cover'} in the library into a single giant image. Chronological sorts by release year; Gradient arranges covers by colour temperature.`,
    maturity: 'Stable',
    tone: 'success',
  },
  {
    to: '/labs/map',
    title: 'World Map',
    description: 'Covers pinned to the countries their artists come from, tiled into a world map you can zoom into.',
    maturity: 'Stable',
    tone: 'success',
  },
  {
    to: '/labs/genome',
    title: 'Genre Genome',
    description: 'A force graph of the genres in the catalogue. Nodes scale with artist count, edges thicken with the number of artists two genres share.',
    maturity: 'Beta',
    tone: 'accent',
  },
  {
    to: '/labs/decades',
    title: 'Decade DNA',
    description: 'Radar profiles per decade across releases, tracks, artists, length and bitrate - normalised to the strongest decade on each axis.',
    maturity: 'Beta',
    tone: 'accent',
  },
  {
    to: '/labs/network',
    title: 'Artist Network',
    description: 'Artists linked by shared tracks. Search to focus one artist, drag to untangle, click a node to walk its collaborators.',
    maturity: 'Experimental',
    tone: 'warning',
  },
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageTitle text="Labs" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="lab in labs"
        :key="lab.to"
        :to="lab.to"
        class="group rounded-xl border border-stone-100/6 bg-stone-900 p-5 transition-colors duration-150 hover:border-stone-100/10 hover:bg-stone-800/50"
      >
        <div class="mb-3 flex items-start justify-between gap-3">
          <h2 :class="[typography.title, 'text-stone-100']">{{ lab.title }}</h2>
          <span :class="cx(outlinePill, toneBg[lab.tone], 'shrink-0 border-transparent font-mono text-2xs uppercase tracking-wider')">
            {{ lab.maturity }}
          </span>
        </div>
        <p class="text-sm leading-relaxed text-stone-100/55">{{ lab.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
