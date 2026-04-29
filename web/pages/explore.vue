<script setup lang="ts">
import { Compass, Play, RefreshCw } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

useHead({ title: 'Explore' })

const player = usePlayerStore()
const { energy, era, familiarity, sound, isLoading, error, explore, playFromHistory } = useExplorer()

const energyStops = ['Sleepy', 'Melancholic', 'Calm', 'Reflective', 'Chill', 'Groovy', 'Upbeat', 'Energetic', 'Fierce', 'Powerful']
const eraStops = ['60s', '70s', '80s', '90s', 'Y2K', 'Late 2000s', 'Early 2010s', 'Late 2010s', '2020s', 'Now']
const familiarityStops = ['Comfort', 'Familiar', 'Known', 'Mixed+', 'Balanced', 'Balanced-', 'Fresh', 'New', 'Hidden', 'Uncharted']
const soundStops = ['Acoustic', 'Unplugged', 'Natural', 'Warm', 'Balanced', 'Hybrid', 'Produced', 'Synthy', 'Digital', 'Electronic']
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8 pb-32">
    <PageTitle :icon="Compass" text="Explore" subtext="Discover something new" class="mb-8" />

    <!-- Sliders -->
    <div class="flex flex-col gap-3">
      <Slider v-model="energy" title="I'm feeling..." left-label="Tired" right-label="Powerful" :stops="energyStops" />
      <Slider v-model="era" title="Era" left-label="Classic" right-label="Modern" :stops="eraStops" />
      <Slider v-model="familiarity" title="Discovery" left-label="Comfort Zone" right-label="Uncharted" :stops="familiarityStops" />
      <Slider v-model="sound" title="Sound" left-label="Acoustic" right-label="Electronic" :stops="soundStops" />
    </div>

    <!-- Explore Button -->
    <div class="mt-6 flex justify-center">
      <button
        class="flex items-center gap-2.5 rounded-xl bg-amber-500 px-8 py-3 text-lg font-bold text-zinc-950 transition-all hover:bg-amber-400 active:scale-95 disabled:opacity-50 disabled:hover:bg-amber-500 disabled:active:scale-100"
        :disabled="isLoading"
        @click="explore"
      >
        <Play v-if="!isLoading" :size="22" class="fill-current" />
        <RefreshCw v-else :size="22" class="animate-spin" />
        {{ isLoading ? 'Finding...' : 'Explore' }}
      </button>
    </div>

    <!-- Error -->
    <p v-if="error" class="mt-4 text-center text-sm text-red-400">{{ error }}</p>

    <!-- Now Playing Card -->
    <div v-if="player.explorerCurrentTrack" class="mt-8">
      <ExploreCard
        :track="player.explorerCurrentTrack"
        :is-loading="isLoading"
        @again="explore"
      />
    </div>

    <!-- Session History -->
    <div v-if="player.explorerSessionHistory.length > 0" class="mt-8">
      <ExploreHistory
        :tracks="player.explorerSessionHistory"
        @play="playFromHistory"
      />
    </div>
  </div>
</template>
