<script setup lang="ts">
import { Play, SlidersHorizontal } from 'lucide-vue-next'
import { cx, surface } from '~/helpers/ui'

const props = defineProps<{
  isLoading?: boolean
  error?: string | null
  collapsed?: boolean
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

const models = { energy, era, familiarity, sound }

const sliders = [
  {
    key: 'energy',
    title: "I'm feeling...",
    leftLabel: 'Tired',
    rightLabel: 'Powerful',
    hint: "Right picks faster, louder, more aggressive songs; left keeps things slow and quiet. This one counts the most.",
    stops: ['Sleepy', 'Melancholic', 'Calm', 'Reflective', 'Chill', 'Groovy', 'Upbeat', 'Energetic', 'Fierce', 'Powerful'],
  },
  {
    key: 'era',
    title: 'Era',
    leftLabel: 'Classic',
    rightLabel: 'Modern',
    hint: 'Favours songs released around the decade you land on.',
    stops: ['60s', '70s', '80s', '90s', 'Y2K', 'Late 2000s', 'Early 2010s', 'Late 2010s', '2020s', 'Now'],
  },
  {
    key: 'familiarity',
    title: 'Discovery',
    leftLabel: 'Comfort zone',
    rightLabel: 'Uncharted',
    hint: 'Left leans on songs you play often; right digs out ones you have barely touched.',
    stops: ['Comfort', 'Familiar', 'Known', 'Mixed+', 'Balanced', 'Balanced-', 'Fresh', 'New', 'Hidden', 'Uncharted'],
  },
  {
    key: 'sound',
    title: 'Sound',
    leftLabel: 'Acoustic',
    rightLabel: 'Electronic',
    hint: 'Left favours guitars and real instruments; right favours synths and electronics.',
    stops: ['Acoustic', 'Unplugged', 'Natural', 'Warm', 'Balanced', 'Hybrid', 'Produced', 'Synthy', 'Digital', 'Electronic'],
  },
] as const

const exploreLabel = computed(() => (props.changing ? 'Explore with these settings' : 'Start exploring!'))

const wrapperClasses = "flex items-center justify-between gap-2 lg:gap-3 rounded-xl border border-stone-100/10 px-3 py-2 lg:px-5 lg:py-3 shadow-[inset_0_1px_0_rgba(255,240,210,.05)] bg-[linear-gradient(100deg,color-mix(in_oklch,var(--color-amber-400)_12%,var(--color-stone-900))_0%,var(--color-stone-900)_42%,var(--color-stone-900)_100%)]"

const blockClasses = "hidden lg:block size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-amber-400)_16%,transparent),0_0_14px_2px_color-mix(in_oklch,var(--color-amber-400)_55%,transparent)] animate-[pulse-lamp_2.6s_ease-in-out_infinite] motion-reduce:animate-none"

const sectionClass = 'px-6 py-5'
</script>

<template>
  <div
    v-if="collapsed"
    :class="wrapperClasses"
  >
    <span :class="blockClasses"  />

    <div :class="cx('min-w-0 flex-1 text-stone-100/60', tv ? 'text-2xl' : 'text-base')">
      Exploring <span class="font-medium text-amber-400">{{ sliders[0].stops[energy] }}</span> tracks of the
      <span>{{ sliders[1].stops[era] }}</span> ·
      <span>{{ sliders[2].stops[familiarity] }}</span> discovery ·
      <span>{{ sliders[3].stops[sound] }}</span> sound
    </div>
    <UiButton variant="secondary" :size="tv ? 'lg' : 'sm'" :icon="SlidersHorizontal" @click="emit('expand')">
      <span class="hidden lg:block">Change</span>
    </UiButton>
  </div>

  <div v-else :class="surface.card">
    <div v-for="slider in sliders" :key="slider.key" :class="[sectionClass, surface.divider]">
      <Slider
        v-model="models[slider.key].value"
        :title="slider.title"
        :left-label="slider.leftLabel"
        :right-label="slider.rightLabel"
        :hint="slider.hint"
        :stops="slider.stops"
      />
    </div>

    <div class="flex items-center justify-center gap-3 px-6 py-5">
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
