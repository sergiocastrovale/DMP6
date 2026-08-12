<script setup lang="ts">
import { Compass } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const { energy, era, familiarity, sound, isLoading, error, explore, playFromHistory } = useExplorer()
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8 pb-32">
    <PageTitle
      :icon="Compass"
      text="Explore"
      subtext="Tell us the mood, we pick a track from your library."
      class="mb-8"
    />

    <div class="flex flex-col gap-8">
      <ExploreConfig
        v-model:energy="energy"
        v-model:era="era"
        v-model:familiarity="familiarity"
        v-model:sound="sound"
        :is-loading="isLoading"
        :error="error"
        @explore="explore"
      />

      <ExploreCard
        v-if="player.explorerCurrentTrack"
        :track="player.explorerCurrentTrack"
        :is-loading="isLoading"
        @again="explore"
      />

      <ExploreHistory
        v-if="player.explorerSessionHistory.length > 0"
        :tracks="player.explorerSessionHistory"
        @play="playFromHistory"
      />
    </div>
  </div>
</template>
