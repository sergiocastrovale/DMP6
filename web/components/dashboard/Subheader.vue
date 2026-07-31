<script setup lang="ts">
const { user } = useAuth()

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
</script>

<template>
  <div class="flex flex-col gap-1">
    <h1 class="font-display text-5xl font-semibold text-ink">
      Hello, {{ user?.username }}
    </h1>
    <p class="text-lg text-ink-3">
      {{ greeting }}
      <span v-if="randomArtist">{{ ctaBefore }}<NuxtLink :to="`/artist/${randomArtist.slug}`" class="text-ink-2 underline decoration-ink-4 underline-offset-2 transition-colors hover:text-ink">{{ randomArtist.name }}</NuxtLink>{{ ctaAfter }}</span>
    </p>
  </div>
  <LayoutStatistics />
</template>
