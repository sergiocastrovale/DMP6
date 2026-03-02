<script setup lang="ts">
import { Compass, Play, RefreshCw, Clock } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import type { PlayerTrack } from '~/types/player'

useHead({ title: 'Explore' })

const player = usePlayerStore()
const { resolve: resolveImage } = useImageUrl()

const energy = ref(5)
const era = ref(5)
const familiarity = ref(4)
const sound = ref(4)

const currentPick = ref<PlayerTrack | null>(null)
const currentPickImage = ref<string | null>(null)
const history = ref<PlayerTrack[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Local history IDs used to avoid re-picking from the explore page itself.
// The player uses its own explorerHistory for dedup during auto-play.
const localExcludeIds = computed(() => history.value.map(t => t.id))

async function explore() {
  isLoading.value = true
  error.value = null

  try {
    const result = await $fetch<PlayerTrack>('/api/tracks/explore', {
      method: 'POST',
      body: {
        energy: energy.value,
        era: era.value,
        familiarity: familiarity.value,
        sound: sound.value,
        excludeIds: localExcludeIds.value,
      },
    })

    if (currentPick.value) {
      history.value.unshift(currentPick.value)
    }

    currentPick.value = result
    currentPickImage.value = resolveImage(
      result.releaseImage,
      result.releaseImageUrl,
      'releases',
    )

    // Play the track and activate explorer shuffle mode with current slider params
    player.playTrack(result)
    player.activateExplorer(
      { energy: energy.value, era: era.value, familiarity: familiarity.value, sound: sound.value },
      result.id,
    )
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to find a track'
  } finally {
    isLoading.value = false
  }
}

function playFromHistory(track: PlayerTrack) {
  player.playTrack(track)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const energyStops = ['Sleepy', 'Melancholic', 'Calm', 'Reflective', 'Chill', 'Groovy', 'Upbeat', 'Energetic', 'Fierce', 'Powerful']
const eraStops = ['60s', '70s', '80s', '90s', 'Y2K', 'Late 2000s', 'Early 2010s', 'Late 2010s', '2020s', 'Now']
const familiarityStops = ['Comfort', 'Familiar', 'Known', 'Mixed+', 'Balanced', 'Balanced-', 'Fresh', 'New', 'Hidden', 'Uncharted']
const soundStops = ['Acoustic', 'Unplugged', 'Natural', 'Warm', 'Balanced', 'Hybrid', 'Produced', 'Synthy', 'Digital', 'Electronic']
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8 pb-32">
    <!-- Header -->
    <div class="mb-8 flex items-center gap-3">
      <Compass :size="28" class="text-amber-500" />
      <div>
        <h1 class="text-2xl font-bold text-zinc-50">Explore</h1>
        <p class="text-sm text-zinc-400">Discover something new</p>
      </div>
    </div>

    <!-- Sliders -->
    <div class="flex flex-col gap-3">
      <Slider
        v-model="energy"
        title="I'm feeling..."
        left-label="Tired"
        right-label="Powerful"
        :stops="energyStops"
      />

      <Slider
        v-model="era"
        title="Era"
        left-label="Classic"
        right-label="Modern"
        :stops="eraStops"
      />

      <Slider
        v-model="familiarity"
        title="Discovery"
        left-label="Comfort Zone"
        right-label="Uncharted"
        :stops="familiarityStops"
      />

      <Slider
        v-model="sound"
        title="Sound"
        left-label="Acoustic"
        right-label="Electronic"
        :stops="soundStops"
      />
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
    <div
      v-if="currentPick"
      class="mt-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
    >
      <div class="flex items-center gap-4 p-4">
        <!-- Cover Art -->
        <div class="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
          <img
            v-if="currentPickImage"
            :src="currentPickImage"
            :alt="currentPick.album"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
            <Compass :size="32" />
          </div>
        </div>

        <!-- Track Info -->
        <div class="min-w-0 flex-1">
          <p class="truncate text-lg font-semibold text-zinc-50">{{ currentPick.title }}</p>
          <p class="truncate text-sm text-zinc-400">{{ currentPick.artist }}</p>
          <p class="truncate text-xs text-zinc-500">
            {{ currentPick.album }}
            <span v-if="currentPick.duration"> · {{ formatDuration(currentPick.duration) }}</span>
          </p>
        </div>

        <!-- Roll Again -->
        <button
          class="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-50 disabled:opacity-50"
          :disabled="isLoading"
          @click="explore"
        >
          <RefreshCw :size="14" :class="isLoading && 'animate-spin'" />
          Again
        </button>
      </div>
    </div>

    <!-- Session History -->
    <div v-if="history.length > 0" class="mt-8">
      <div class="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
        <Clock :size="14" />
        Session History
      </div>

      <div class="flex flex-col divide-y divide-zinc-800/50 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <button
          v-for="track in history"
          :key="track.id"
          class="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/50"
          @click="playFromHistory(track)"
        >
          <Play :size="14" class="shrink-0 text-zinc-500" />
          <span class="min-w-0 flex-1 truncate text-sm text-zinc-300">
            {{ track.title }}
            <span class="text-zinc-500"> — {{ track.artist }}</span>
          </span>
          <span v-if="track.duration" class="shrink-0 text-xs tabular-nums text-zinc-600">
            {{ formatDuration(track.duration) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
