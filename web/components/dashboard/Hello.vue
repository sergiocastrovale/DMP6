<script setup lang="ts">
import { typography } from '~/helpers/ui'

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

// useState (not a plain Math.random() call): the seed must match between SSR and client hydration,
// or the greeting text differs between passes and Vue flags a hydration mismatch.
const seed = useState('dashboard-hello-seed', () => Math.floor(Math.random() * 1000))
const greeting = pick(greetings, seed.value)

const { data: randomArtist } = useFetch('/api/artists/random')
const [ctaBefore, ctaAfter] = randomArtist ? pick(ctas, seed.value + 1) : ['', '']
</script>

<template>
  <div class="flex flex-col gap-1">
    <h1 :class="typography.h1">
      Hello, {{ user?.username }}
    </h1>
    <p class="text-lg text-stone-100/55">
      {{ greeting }}
      <span v-if="randomArtist">{{ ctaBefore }}
        <NuxtLink :to="`/artist/${randomArtist.slug}`" class="text-stone-100/60 underline decoration-stone-100/30 underline-offset-2 transition-colors duration-150 hover:text-stone-100">
          {{ randomArtist.name }}
        </NuxtLink>
        {{ ctaAfter }}
      </span>
    </p>
  </div>
</template>