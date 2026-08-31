<script setup lang="ts">
import { Disc3, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, typography } from '~/helpers/ui'

const props = defineProps<{
  track: PlayerTrack
  isLoading?: boolean
}>()

const emit = defineEmits<{
  again: []
}>()

const player = usePlayerStore()
const { resolve: resolveImage } = useImageUrl()

const image = computed(() =>
  resolveImage(props.track.releaseImage, props.track.releaseImageUrl, 'releases'),
)
</script>

<template>
  <div
    :class="cx(
      'relative overflow-hidden rounded-xl border border-stone-100/10 p-6',
      'bg-[radial-gradient(120%_90%_at_50%_-18%,color-mix(in_oklch,var(--color-amber-400)_22%,transparent)_0%,transparent_62%),linear-gradient(180deg,var(--color-stone-800)_0%,var(--color-stone-900)_46%,#100f0d_100%)]',
      'shadow-[0_40px_80px_-40px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,240,210,.07)]',
      'before:absolute before:left-1/2 before:-top-[58%] before:-translate-x-1/2 before:w-[150%] before:aspect-[1.7/1] before:rounded-[50%] before:border before:border-amber-400/15 before:pointer-events-none',
      'after:absolute after:inset-0 after:pointer-events-none after:bg-[repeating-linear-gradient(90deg,rgba(255,240,210,.028)_0_1px,transparent_1px_7px)] after:[mask-image:linear-gradient(180deg,transparent_62%,#000_100%)]',
    )"
  >
    <div class="relative flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      <div class="size-40 shrink-0 overflow-hidden rounded-lg bg-stone-800 sm:size-48">
        <img
          v-if="image"
          :src="image"
          :alt="track.album"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-stone-100/20">
          <Disc3 :size="48" :stroke-width="ICON_STROKE_WIDTH" />
        </div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-4 text-center sm:text-left">
        <div class="min-w-0">
          <h2 class="truncate font-display text-3xl font-bold text-stone-100">{{ track.title }}</h2>
          <NuxtLink
            v-if="track.artistSlug"
            :to="`/artist/${track.artistSlug}`"
            class="block truncate text-lg font-medium text-amber-400 transition-colors duration-150 hover:text-amber-300"
          >
            {{ track.artist }}
          </NuxtLink>
          <p v-else class="truncate text-lg font-medium text-amber-400">{{ track.artist }}</p>
          <p :class="[typography.meta, 'truncate']">{{ track.album }}</p>
        </div>

        <PlayerSeekBar :current-time="player.currentTime" :duration="player.duration" count-down @seek="(time) => player.seek(time)" />

        <div class="flex items-center justify-center gap-3 sm:justify-start">
          <button
            type="button"
            class="rounded-full p-2 text-stone-100/60 transition-colors duration-150 hover:text-stone-100"
            aria-label="Previous track"
            @click="player.previous()"
          >
            <SkipBack :size="18" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <PlayerPlayPauseButton
            :playing="player.isPlaying"
            size="lg"
            highlighted
            @click="player.togglePlay()"
          />

          <button
            type="button"
            class="rounded-full p-2 text-stone-100/60 transition-colors duration-150 hover:text-stone-100"
            aria-label="Next track"
            @click="player.next()"
          >
            <SkipForward :size="18" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <ToggleFavorite :size="18" always-visible class="p-2" />

          <div class="flex-1" />

          <UiButton variant="secondary" :icon="Shuffle" :loading="isLoading" @click="emit('again')">
            Another pick
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
