<script setup lang="ts">
import { Disc3, SkipBack, SkipForward, X } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, sw, typography } from '~/helpers/ui'

defineProps<{ visible: boolean }>()

const emit = defineEmits<{ close: [] }>()

const player = usePlayerStore()
const { preset, presets, setPreset } = useVisualizer()
const { resolve } = useImageUrl()

const albumCover = computed(() =>
  resolve(player.currentTrack?.releaseImage ?? null, player.currentTrack?.releaseImageUrl ?? null, 'releases'),
)
</script>

<template>
  <!-- Faded rather than v-if'd: unmounting would drop the seek bar's DOM identity (and the
       pointer capture mid-drag with it) every time the idle timer fired. -->
  <div
    :class="cx(
      'absolute inset-x-0 bottom-0 flex flex-col gap-4 p-6 transition-opacity duration-300',
      'bg-[linear-gradient(0deg,rgba(0,0,0,.85)_0%,transparent_100%)]',
      visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
    )"
    data-testid="visualizer-hud"
  >
    <div class="flex items-center gap-4">
      <div
        class="size-16 shrink-0 rounded-md bg-stone-800 bg-cover bg-center"
        :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
      >
        <Disc3 v-if="!albumCover" :size="26" class="m-auto mt-5 text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
      </div>

      <div class="min-w-0 flex-1">
        <h2 class="truncate font-display text-2xl font-bold text-stone-100">
          {{ player.currentTrack?.title || 'No track' }}
        </h2>
        <p :class="cx(typography.meta, 'truncate text-lg')">
          {{ player.currentTrack?.artist }}
          <template v-if="player.currentTrack?.album">&middot; {{ player.currentTrack.album }}</template>
        </p>
      </div>

      <div class="hidden items-center gap-1 md:flex">
        <button
          v-for="option in presets"
          :key="option.id"
          type="button"
          :class="sw('tab', preset === option.id)"
          :aria-pressed="preset === option.id"
          :title="`${option.description} (press ${option.key})`"
          @click="setPreset(option.id)"
        >
          {{ option.label }}
        </button>
      </div>

      <UiButton
        variant="ghost"
        size="lg"
        icon-only
        :icon="X"
        title="Exit visualizer (Esc)"
        aria-label="Exit visualizer"
        @click="emit('close')"
      />
    </div>

    <div class="flex items-center gap-5">
      <UiButton variant="secondary" icon-only :icon="SkipBack" aria-label="Previous track" @click="player.previous()" />
      <PlayerPlayPauseButton :playing="player.isPlaying" size="lg" highlighted @click="player.togglePlay()" />
      <UiButton variant="secondary" icon-only :icon="SkipForward" aria-label="Next track" @click="player.next()" />
      <div class="flex-1">
        <PlayerSeekBar
          :current-time="player.currentTime"
          :duration="player.duration"
          count-down
          @seek="(time) => player.seek(time)"
        />
      </div>
    </div>
  </div>
</template>
