<script setup lang="ts">
import { Play } from 'lucide-vue-next'

defineProps<{
  isLoading?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  explore: []
}>()

const energy = defineModel<number>('energy', { required: true })
const era = defineModel<number>('era', { required: true })
const familiarity = defineModel<number>('familiarity', { required: true })
const sound = defineModel<number>('sound', { required: true })

const energyStops = ['Sleepy', 'Melancholic', 'Calm', 'Reflective', 'Chill', 'Groovy', 'Upbeat', 'Energetic', 'Fierce', 'Powerful']
const eraStops = ['60s', '70s', '80s', '90s', 'Y2K', 'Late 2000s', 'Early 2010s', 'Late 2010s', '2020s', 'Now']
const familiarityStops = ['Comfort', 'Familiar', 'Known', 'Mixed+', 'Balanced', 'Balanced-', 'Fresh', 'New', 'Hidden', 'Uncharted']
const soundStops = ['Acoustic', 'Unplugged', 'Natural', 'Warm', 'Balanced', 'Hybrid', 'Produced', 'Synthy', 'Digital', 'Electronic']
</script>

<template>
  <div class="flex flex-col gap-3">
    <Slider
      v-model="energy"
      title="I'm feeling..."
      left-label="Tired"
      right-label="Powerful"
      hint="Right picks faster, louder, more aggressive songs; left keeps things slow and quiet. This one counts the most."
      :stops="energyStops"
    />
    <Slider
      v-model="era"
      title="Era"
      left-label="Classic"
      right-label="Modern"
      hint="Favours songs released around the decade you land on."
      :stops="eraStops"
    />
    <Slider
      v-model="familiarity"
      title="Discovery"
      left-label="Comfort Zone"
      right-label="Uncharted"
      hint="Left leans on songs you play often; right digs out ones you have barely touched."
      :stops="familiarityStops"
    />
    <Slider
      v-model="sound"
      title="Sound"
      left-label="Acoustic"
      right-label="Electronic"
      hint="Left favours guitars and real instruments; right favours synths and electronics."
      :stops="soundStops"
    />

    <div class="mt-3 flex justify-center">
      <UiButton size="lg" :icon="Play" icon-class="fill-current" :loading="isLoading" @click="emit('explore')">
        Explore
      </UiButton>
    </div>

    <p v-if="error" class="text-center text-sm text-red-400">{{ error }}</p>
  </div>
</template>
