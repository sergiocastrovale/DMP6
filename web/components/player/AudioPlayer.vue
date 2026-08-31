<script setup lang="ts">
import {
  Check,
  Compass,
  ListPlus,
  Plus,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { button, cx, ICON_STROKE_WIDTH, typography } from '~/helpers/ui'
import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'

const player = usePlayerStore()
const { resolve } = useImageUrl()

const albumCover = computed(() =>
  resolve(player.currentTrack?.releaseImage ?? null, player.currentTrack?.releaseImageUrl ?? null, 'releases'),
)

// Cover art and release title both deep-link to the artist page anchored on this exact release -
// ArtistReleases.vue's handleReleaseDeepLink already expands/scrolls to a release from ?releaseId=.
const releaseLink = computed(() => {
  const slug = player.currentTrack?.artistSlug
  if (!slug) {
    return null
  }
  const localReleaseId = player.currentTrack?.localReleaseId
  return { path: `/artist/${slug}`, query: localReleaseId ? { releaseId: localReleaseId } : undefined }
})

const showPlaylistMenu = ref(false)
const showNewPlaylistDialog = ref(false)
const playlists = ref<any[]>([])
const trackPlaylistSlugs = ref<Set<string>>(new Set())

const showInfoDialog = ref(false)
const infoRelease = ref<UnifiedRelease | null>(null)
const infoExtra = ref<ReleaseInfoExtra | null>(null)

async function openTrackInfo() {
  const localReleaseId = player.currentTrack?.localReleaseId
  if (!localReleaseId) {
    return
  }
  infoRelease.value = null
  infoExtra.value = null
  showInfoDialog.value = true
  try {
    const [release, extra] = await Promise.all([
      $fetch<UnifiedRelease>(`/api/releases/${localReleaseId}`),
      $fetch<ReleaseInfoExtra>(`/api/releases/${localReleaseId}/info`),
    ])
    infoRelease.value = release
    infoExtra.value = extra
  }
  catch { /* ignore */ }
}

watch(() => player.currentTrack?.id, () => {
  showInfoDialog.value = false
})

// Always-visible context pill: what queue is currently playing, not just whether shuffle is on.
const CONTEXT_LABELS: Record<string, string> = {
  explorer: 'Explorer',
  catalogue: 'Catalogue',
  artist: 'Artist',
  release: 'Release',
}

const contextLabel = computed(() => CONTEXT_LABELS[player.shuffleMode])

const SHUFFLE_TOOLTIPS: Record<string, string> = {
  off: 'Shuffle: Off',
  release: 'Shuffle: Release',
  artist: 'Shuffle: Artist',
  catalogue: 'Shuffle: Catalogue',
  explorer: 'Explorer mode - click to turn off',
}

async function loadPlaylists() {
  try {
    const [all, slugs] = await Promise.all([
      $fetch<any[]>('/api/playlists'),
      player.currentTrack
        ? $fetch<string[]>(`/api/tracks/${player.currentTrack.id}/playlists`)
        : Promise.resolve([]),
    ])
    playlists.value = all.filter((p: any) => p.type === 'MANUAL')
    trackPlaylistSlugs.value = new Set(slugs)
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
}

async function togglePlaylist(playlistSlug: string) {
  if (!player.currentTrack)
    {return}
  const isIn = trackPlaylistSlugs.value.has(playlistSlug)
  try {
    if (isIn) {
      await $fetch(`/api/playlists/${playlistSlug}/tracks/${player.currentTrack.id}`, {
        method: 'DELETE',
      })
      trackPlaylistSlugs.value.delete(playlistSlug)
    }
    else {
      await $fetch(`/api/playlists/${playlistSlug}/tracks`, {
        method: 'POST',
        body: { trackId: player.currentTrack.id },
      })
      trackPlaylistSlugs.value.add(playlistSlug)
    }
  }
  catch (error) {
    console.error('Failed to update playlist:', error)
  }
}

function openNewPlaylistDialog() {
  showPlaylistMenu.value = false
  showNewPlaylistDialog.value = true
}

async function onPlaylistCreated() {
  await loadPlaylists()
}

</script>

<template>
  <div
    v-if="player.isVisible"
    :class="cx(
      'relative flex w-full flex-col justify-center',
      'bg-[radial-gradient(120%_240%_at_50%_130%,color-mix(in_oklch,var(--color-amber-400)_13%,transparent)_0%,transparent_60%),linear-gradient(180deg,rgba(28,24,19,.94)_0%,rgba(16,15,13,.96)_100%)]',
      'backdrop-blur-[28px] [backdrop-filter:blur(28px)_saturate(150%)]',
      'shadow-[0_-20px_50px_-30px_rgba(0,0,0,.95),inset_0_1px_0_rgba(255,240,210,.05)]',
      'after:absolute after:inset-0 after:pointer-events-none after:bg-[repeating-linear-gradient(90deg,rgba(255,240,210,.022)_0_1px,transparent_1px_7px)] after:[mask-image:linear-gradient(0deg,#000,transparent_78%)]',
    )"
  >
    <div class="absolute inset-x-0 top-0 z-10">
      <PlayerSeekBar
        slim
        hover-popover
        :current-time="player.currentTime"
        :duration="player.duration"
        @seek="(time) => player.seek(time)"
      />
    </div>

    <div class="relative flex h-[84px] items-center px-4 pt-2">
      <div class="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:w-1/3">
        <div class="relative size-12 shrink-0">
          <div
            :class="cx(
              'absolute -left-1.5 top-1/2 size-11 -translate-y-1/2 rounded-full shadow-[0_3px_10px_rgba(0,0,0,.6)]',
              'bg-[radial-gradient(circle_at_50%_50%,#2a2622_0_16%,#121110_16.5%_18%,#1b1917_18.5%_100%)]',
              'before:absolute before:inset-[8%] before:rounded-full before:bg-[repeating-radial-gradient(circle_at_50%_50%,rgba(255,245,220,.06)_0_1px,transparent_1px_3px)]',
              'after:absolute after:inset-[40%] after:rounded-full after:bg-amber-400 after:opacity-85',
              player.isPlaying && 'animate-[spin-slow_5.5s_linear_infinite] motion-reduce:animate-none',
            )"
          />
          <NuxtLink
            v-if="releaseLink"
            :to="releaseLink"
            class="relative z-[1] block size-12 shrink-0 rounded-md bg-stone-800 bg-cover bg-center transition-opacity duration-150 hover:opacity-80"
            :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
            :aria-label="`Go to ${player.currentTrack?.album || player.currentTrack?.title || 'release'}`"
          />
          <div
            v-else
            class="relative z-[1] block size-12 shrink-0 rounded-md bg-stone-800 bg-cover bg-center"
            :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5 mb-0.5">
            <button
              type="button"
              :class="cx(
                'truncate text-sm font-medium text-stone-100 text-left transition-colors duration-150',
                player.currentTrack?.localReleaseId ? 'cursor-pointer hover:text-amber-400' : 'cursor-default',
              )"
              :aria-label="`${player.currentTrack?.title ?? 'Track'} info`"
              @click="openTrackInfo"
            >
              {{ player.currentTrack?.title || 'No track' }}
            </button>
            <ToggleFavorite :size="12" />
          </div>
          <div :class="cx(typography.meta, 'truncate')">
            <NuxtLink
              v-if="player.currentTrack?.artistSlug"
              :to="`/artist/${player.currentTrack.artistSlug}`"
              class="hover:text-stone-100 transition-colors duration-150"
            >
              {{ player.currentTrack?.artist }}
            </NuxtLink>
            <span v-else>{{ player.currentTrack?.artist }}</span>
            <template v-if="player.currentTrack?.album">
              &middot;
              <NuxtLink
                v-if="releaseLink"
                :to="releaseLink"
                class="hover:text-stone-100 transition-colors duration-150"
              >
                {{ player.currentTrack.album }}
              </NuxtLink>
              <span v-else>{{ player.currentTrack.album }}</span>
            </template>
          </div>
        </div>
      </div>

      <div class="flex flex-1 flex-col items-center justify-center">
        <div :class="cx('flex items-center gap-4', player.shuffleMode !== 'off' && '-ml-16')">
          <button
            type="button"
            :class="cx(
              'flex w-8.5 h-8.5 gap-1 items-center justify-center overflow-hidden rounded-full border transition-colors duration-150 cursor-pointer bg-stone-800 hover:bg-stone-700',
              player.shuffleMode !== 'off'
                ? 'border-amber-400/45 text-amber-400 w-24 shrink-0 '
                : 'border-stone-100/10 text-stone-100/60 hover:text-stone-100',
            )"
            :title="SHUFFLE_TOOLTIPS[player.shuffleMode]"
            :aria-label="SHUFFLE_TOOLTIPS[player.shuffleMode]"
            @click="player.cycleShuffleMode()"
          >
            <span v-if="player.shuffleMode !== 'off'" class="flex justify-center text-[9px] uppercase tracking-wider">
              {{ contextLabel }}
            </span>
            <span class="flex h-8.5 shrink-0 items-center justify-center">
              <Compass v-if="player.shuffleMode === 'explorer'" :size="16" :stroke-width="ICON_STROKE_WIDTH" />
              <Shuffle v-else :size="16" :stroke-width="ICON_STROKE_WIDTH" />
            </span>
          </button>

          <button
            type="button"
            :class="button('secondary', 'md', '', false, true)"
            aria-label="Previous track"
            @click="player.previous()"
          >
            <SkipBack :size="16" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <PlayerPlayPauseButton
            :playing="player.isPlaying"
            size="lg"
            highlighted
            @click="player.togglePlay()"
          />

          <button
            type="button"
            :class="button('secondary', 'md', '', false, true)"
            aria-label="Next track"
            @click="player.next()"
          >
            <SkipForward :size="16" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <div class="relative">
            <button
              type="button"
              :class="button('secondary', 'md', '', showPlaylistMenu, true)"
              aria-label="Add to playlist"
              aria-haspopup="menu"
              :aria-expanded="showPlaylistMenu"
              @click="showPlaylistMenu = !showPlaylistMenu; loadPlaylists()"
            >
              <ListPlus :size="16" :stroke-width="ICON_STROKE_WIDTH" />
            </button>
            <div
              v-if="showPlaylistMenu"
              role="menu"
              class="absolute bottom-full left-0 z-20 mb-2 w-48 rounded-lg border border-stone-100/10 bg-stone-900 shadow-lg"
            >
              <div class="max-h-64 overflow-y-auto p-2">
                <div class="mb-2 flex justify-center">
                  <UiButton variant="quiet" size="sm" on :icon="Plus" @click="openNewPlaylistDialog">
                    Create new playlist
                  </UiButton>
                </div>
                <div v-if="playlists.length > 0" class="border-t border-stone-100/6 pt-2">
                  <button
                    v-for="playlist in playlists"
                    :key="playlist.id"
                    type="button"
                    role="menuitemcheckbox"
                    :aria-checked="trackPlaylistSlugs.has(playlist.slug)"
                    :class="cx('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-stone-800', trackPlaylistSlugs.has(playlist.slug) ? 'text-amber-400' : 'text-stone-100/60')"
                    @click="togglePlaylist(playlist.slug)"
                  >
                    {{ playlist.name }}
                    <Check v-if="trackPlaylistSlugs.has(playlist.slug)" :size="14" :stroke-width="ICON_STROKE_WIDTH" />
                  </button>
                </div>
                <div v-if="playlists.length === 0" class="px-3 py-2 text-sm text-stone-100/55">
                  No playlists yet
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="hidden md:flex md:w-1/3 items-center justify-end gap-4">
        <PlayerVolumeControl />
        <button
          type="button"
          class="text-stone-100/55 hover:text-stone-100 transition-colors duration-150"
          title="Dismiss player"
          @click="player.dismiss()"
        >
          <X :size="18" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>
      <button
        type="button"
        class="ml-2 shrink-0 text-stone-100/55 hover:text-stone-100 transition-colors duration-150 md:hidden"
        title="Dismiss player"
        @click="player.dismiss()"
      >
        <X :size="18" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
    </div>

    <PlaylistAddDialog
      v-model="showNewPlaylistDialog"
      :track-id="player.currentTrack?.id ?? null"
      @created="onPlaylistCreated"
    />

    <ReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />
  </div>
</template>
