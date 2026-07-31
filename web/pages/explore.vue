<script setup lang="ts">
import { Compass, Play } from 'lucide-vue-next'
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

    <div class="flex flex-col gap-3">
      <Slider v-model="energy" title="I'm feeling..." left-label="Tired" right-label="Powerful" :stops="energyStops" />
      <Slider v-model="era" title="Era" left-label="Classic" right-label="Modern" :stops="eraStops" />
      <Slider v-model="familiarity" title="Discovery" left-label="Comfort Zone" right-label="Uncharted" :stops="familiarityStops" />
      <Slider v-model="sound" title="Sound" left-label="Acoustic" right-label="Electronic" :stops="soundStops" />
    </div>

    <div class="mt-6 flex justify-center">
      <UiButton size="lg" :icon="Play" icon-class="fill-current" :loading="isLoading" @click="explore">
        Explore
      </UiButton>
    </div>

    <p v-if="error" class="mt-4 text-center text-sm text-red-400">{{ error }}</p>

    <div v-if="player.explorerCurrentTrack" class="mt-8">
      <ExploreCard
        :track="player.explorerCurrentTrack"
        :is-loading="isLoading"
        @again="explore"
      />
    </div>

    <div v-if="player.explorerSessionHistory.length > 0" class="mt-8">
      <ExploreHistory
        :tracks="player.explorerSessionHistory"
        @play="playFromHistory"
      />
    </div>
  </div>
</template>
