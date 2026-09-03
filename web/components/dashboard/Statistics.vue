<script setup lang="ts">
import { useGlobalStore } from '~/stores/global'
import { formatFileSize, formatNumber } from '~/helpers/functions'

const global = useGlobalStore()

// Artists/Total Plays/Size are cut on mobile (`mobileHidden`) - seven stats plus their separators
// don't fit a phone-width header without wrapping or shrinking the type past readable.
//
// `leadsOnMobile` marks each stat's separator: true only when an earlier stat is ALSO visible on
// mobile. A plain `i > 0` left a stray leading separator + gap in front of Releases once Artists (the
// first array item) became mobileHidden - the separator belongs to "is there a stat before ME in the
// array", not "is there a stat before me that's actually showing".
const stats = computed(() => {
  const raw = [
    { label: 'Artists', value: formatNumber(global.stats.artists), mobileHidden: true },
    { label: 'Releases', value: formatNumber(global.stats.releases) },
    { label: 'Tracks', value: formatNumber(global.stats.tracks) },
    { label: 'Genres', value: formatNumber(global.stats.genres) },
    { label: 'Total Plays', value: formatNumber(global.stats.totalPlays), mobileHidden: true },
    { label: 'Playtime', value: `${formatNumber(global.playtimeHours)}h ${global.playtimeMinutes}m` },
    { label: 'Size', value: formatFileSize(global.stats.totalFileSize), mobileHidden: true },
  ]
  let seenOnMobile = false
  return raw.map((stat) => {
    const separatorOnMobile = !stat.mobileHidden && seenOnMobile
    if (!stat.mobileHidden) {
      seenOnMobile = true
    }
    return { ...stat, separatorOnMobile }
  })
})
</script>

<template>
  <div class="flex items-center gap-3 md:gap-5">
    <template v-for="(stat, i) in stats" :key="stat.label">
      <div v-if="i > 0" class="my-1 w-px self-stretch bg-stone-100/6" :class="stat.separatorOnMobile ? '' : 'hidden md:block'" />
      <div class="flex-col gap-0 leading-none" :class="stat.mobileHidden ? 'hidden md:flex' : 'flex'">
        <UiSkeleton v-if="!global.loaded" w="w-8" h="h-[1em]" />
        <div v-else class="font-display font-semibold text-stone-100 tabular-nums">
          {{ stat.value }}
        </div>
        <div class="mt-1.5 font-mono text-xs uppercase text-stone-100/50">
          {{ stat.label }}
        </div>
      </div>
    </template>
  </div>
</template>