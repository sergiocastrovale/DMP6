<script setup lang="ts">
import { Disc3, SkipBack, SkipForward } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, typography } from '~/helpers/ui'

const props = defineProps<{
  track: PlayerTrack
  tv?: boolean
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
    <div class="relative flex flex-col items-center gap-6 sm:flex-row sm:items-stretch">
      <div :class="cx('shrink-0 overflow-hidden rounded-lg bg-stone-800', tv ? 'size-64 sm:size-80' : 'size-40 sm:size-48')">
        <img
          v-if="image"
          :src="image"
          :alt="track.album"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-stone-100/20">
          <Disc3 :size="tv ? 80 : 48" :stroke-width="ICON_STROKE_WIDTH" />
        </div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col text-center sm:text-left">
        <div>
          <div class="flex items-center gap-1">
            <h2 :class="cx('truncate font-display font-bold text-stone-100', tv ? 'text-5xl' : 'text-3xl')">{{ track.title }}</h2>
            <ToggleFavorite :size="tv ? 24 : 18" always-visible :class="tv ? 'p-4' : 'p-2'" />
          </div>
          <NuxtLink
            v-if="track.artistSlug"
            :to="`/artist/${track.artistSlug}`"
            :class="cx('block truncate font-medium text-amber-400 transition-colors duration-150 hover:text-amber-300', tv ? 'text-2xl' : 'text-lg')"
          >
            {{ track.artist }}
          </NuxtLink>
          <p
            v-else
            :class="cx('truncate font-medium text-amber-400', tv ? 'text-2xl' : 'text-lg')"
          >
            {{ track.artist }}
          </p>

          <p :class="[typography.meta, 'truncate', tv && 'text-xl', 'mt-2']">{{ track.album }}</p>
        </div>

        <!-- Grows to push the seek bar + transport to the bottom of the card, matching the album
             art's height, instead of the gap being spread evenly across every row. -->
        <div class="flex-1" />

        <div class="flex flex-col gap-4">
          <PlayerSeekBar :current-time="player.currentTime" :duration="player.duration" count-down :large="tv" @seek="(time) => player.seek(time)" />

          <div :class="cx('flex w-full items-center justify-center', tv ? 'gap-5' : 'gap-3')">
            <UiButton
              variant="secondary"
              :size="tv ? 'xl' : 'lg'"
              icon-only
              :icon="SkipBack"
              aria-label="Previous track"
              @click="player.previous()"
            />

            <PlayerPlayPauseButton
              :playing="player.isPlaying"
              :size="tv ? 'xl' : 'lg'"
              highlighted
              @click="player.togglePlay()"
            />

            <!-- No "Another pick" button here: with shuffleMode 'explorer', player.next() already
                 fetches a fresh explored track (see stores/player.ts), so this is that action. -->
            <UiButton
              variant="secondary"
              :size="tv ? 'xl' : 'lg'"
              icon-only
              :icon="SkipForward"
              aria-label="Next track"
              @click="player.next()"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
