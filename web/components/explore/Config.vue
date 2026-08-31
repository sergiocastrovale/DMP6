<script setup lang="ts">
import { Play, SlidersHorizontal } from 'lucide-vue-next'
import { cx, surface } from '~/helpers/ui'

const props = defineProps<{
  isLoading?: boolean
  error?: string | null
  // Once a track has been explored, the sliders collapse into a one-line summary - re-expanded
  // via the "Change" button below.
  collapsed?: boolean
  // True while re-opened over an already-playing track: the footer then offers a way back out
  // without committing, which a first run has nothing to return to.
  changing?: boolean
  tv?: boolean
}>()

const emit = defineEmits<{
  explore: []
  expand: []
  cancel: []
}>()

const energy = defineModel<number>('energy', { required: true })
const era = defineModel<number>('era', { required: true })
const familiarity = defineModel<number>('familiarity', { required: true })
const sound = defineModel<number>('sound', { required: true })

const energyStops = ['Sleepy', 'Melancholic', 'Calm', 'Reflective', 'Chill', 'Groovy', 'Upbeat', 'Energetic', 'Fierce', 'Powerful']
const eraStops = ['60s', '70s', '80s', '90s', 'Y2K', 'Late 2000s', 'Early 2010s', 'Late 2010s', '2020s', 'Now']
const familiarityStops = ['Comfort', 'Familiar', 'Known', 'Mixed+', 'Balanced', 'Balanced-', 'Fresh', 'New', 'Hidden', 'Uncharted']
const soundStops = ['Acoustic', 'Unplugged', 'Natural', 'Warm', 'Balanced', 'Hybrid', 'Produced', 'Synthy', 'Digital', 'Electronic']

const exploreLabel = computed(() => (props.changing ? 'Explore with these settings' : 'Explore'))

const sectionClass = 'px-6 py-5'
</script>

<template>
  <div
    v-if="collapsed"
    class="flex items-center gap-3 rounded-xl border border-stone-100/10 px-5 py-3
      shadow-[inset_0_1px_0_rgba(255,240,210,.05)]
      bg-[linear-gradient(100deg,color-mix(in_oklch,var(--color-amber-400)_12%,var(--color-stone-900))_0%,var(--color-stone-900)_42%,var(--color-stone-900)_100%)]"
  >
    <span
      class="size-2 shrink-0 rounded-full bg-amber-400
        shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-amber-400)_16%,transparent),0_0_14px_2px_color-mix(in_oklch,var(--color-amber-400)_55%,transparent)]
        animate-[pulse-lamp_2.6s_ease-in-out_infinite] motion-reduce:animate-none"
    />
    <p :class="cx('min-w-0 flex-1 truncate text-stone-100/60', tv ? 'text-2xl' : 'text-base')">
      Exploring <span class="font-medium text-amber-400">{{ energyStops[energy] }}</span> tracks of the
      <span class="font-medium text-stone-100">{{ eraStops[era] }}</span> ·
      <span class="font-medium text-stone-100">{{ familiarityStops[familiarity] }}</span> discovery ·
      <span class="font-medium text-stone-100">{{ soundStops[sound] }}</span> sound
    </p>
    <UiButton variant="secondary" :size="tv ? 'lg' : 'sm'" :icon="SlidersHorizontal" @click="emit('expand')">
      Change
    </UiButton>
  </div>

  <!-- One card, four sections divided by hairlines, actions in the footer - the four dials read as
       one decision rather than four unrelated widgets. -->
  <div v-else :class="surface.card">
    <div :class="[sectionClass, surface.divider]">
      <Slider
        v-model="energy"
        title="I'm feeling..."
        left-label="Tired"
        right-label="Powerful"
        hint="Right picks faster, louder, more aggressive songs; left keeps things slow and quiet. This one counts the most."
        :stops="energyStops"
      />
    </div>
    <div :class="[sectionClass, surface.divider]">
      <Slider
        v-model="era"
        title="Era"
        left-label="Classic"
        right-label="Modern"
        hint="Favours songs released around the decade you land on."
        :stops="eraStops"
      />
    </div>
    <div :class="[sectionClass, surface.divider]">
      <Slider
        v-model="familiarity"
        title="Discovery"
        left-label="Comfort zone"
        right-label="Uncharted"
        hint="Left leans on songs you play often; right digs out ones you have barely touched."
        :stops="familiarityStops"
      />
    </div>
    <div :class="[sectionClass, surface.divider]">
      <Slider
        v-model="sound"
        title="Sound"
        left-label="Acoustic"
        right-label="Electronic"
        hint="Left favours guitars and real instruments; right favours synths and electronics."
        :stops="soundStops"
      />
    </div>

    <div class="flex items-center justify-end gap-3 px-6 py-5">
      <p v-if="error" class="mr-auto text-sm text-danger">{{ error }}</p>
      <UiButton v-if="changing" size="lg" variant="secondary" @click="emit('cancel')">
        Cancel changes
      </UiButton>
      <UiButton size="lg" :icon="Play" icon-class="fill-current" :loading="isLoading" @click="emit('explore')">
        {{ exploreLabel }}
      </UiButton>
    </div>
  </div>
</template>
