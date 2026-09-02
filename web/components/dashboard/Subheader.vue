<script setup lang="ts">
import { useGlobalStore } from '~/stores/global'
import { formatFileSize, formatNumber } from '~/helpers/functions'
import { typography } from '~/helpers/ui'

const { user } = useAuth()
const global = useGlobalStore()

const greetings = [
  'Time to press play!',
  'Let\'s dive into your collection!',
  'Your library awaits!',
  'Let\'s get the party started!',
  'Something new is waiting!',
  'Your next favorite track is in here!',
  'Dust off a hidden gem!',
  'Turn it up!',
  'Let\'s go deeper into your library!',
]

const ctas: [string, string][] = [
  ['When did you last listen to ', '?'],
  ['Have you checked out ', ' lately?'],
  ['Rediscover ', ' today.'],
  ['Do you remember ', '?'],
  ['', ' might surprise you.'],
  ['Ever explored ', '\'s full catalogue?'],
  ['How about some ', '?'],
  ['It\'s been a while since ', ', hasn\'t it?'],
]

const pick = <T,>(arr: T[], seed: number): T => arr[seed % arr.length]!

const seed = useState('dashboard-seed', () => Math.floor(Math.random() * 1000))
const greeting = pick(greetings, seed.value)

const { data: randomArtist } = await useFetch('/api/artists/random')
const [ctaBefore, ctaAfter] = randomArtist.value ? pick(ctas, seed.value + 1) : ['', '']

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
  <div class="flex flex-col gap-1">
    <h1 :class="typography.h1">
      Hello, {{ user?.username }}
    </h1>
    <p class="text-lg text-stone-100/55">
      {{ greeting }}
      <span v-if="randomArtist">{{ ctaBefore }}<NuxtLink :to="`/artist/${randomArtist.slug}`" class="text-stone-100/60 underline decoration-stone-100/30 underline-offset-2 transition-colors duration-150 hover:text-stone-100">{{ randomArtist.name }}</NuxtLink>{{ ctaAfter }}</span>
    </p>
  </div>

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
