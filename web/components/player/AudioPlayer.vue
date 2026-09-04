<script setup lang="ts">
import {
  Compass,
  Disc3,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, surface, typography } from '~/helpers/ui'
import { SHUFFLE_CONTEXT_LABELS, SHUFFLE_TOOLTIPS } from '~/helpers/constants'

const player = usePlayerStore()
const { resolve } = useImageUrl()
const {
  showPlaylistMenu, showNewPlaylistDialog, playlists, trackPlaylistSlugs,
  showInfoDialog, infoRelease, infoExtra,
  loadPlaylists, togglePlaylist, openNewPlaylistDialog, onPlaylistCreated, openTrackInfo,
} = usePlayerActions()

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

// Always-visible context pill: what queue is currently playing, not just whether shuffle is on.
const contextLabel = computed(() => SHUFFLE_CONTEXT_LABELS[player.shuffleMode])
</script>

<template>
  <div
    v-if="player.isVisible"
    :class="cx('relative hidden w-full flex-col justify-center lg:flex', surface.playerBar)"
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
      <div class="flex w-1/3 items-center gap-3">
        <div class="relative size-12 shrink-0">
          <div
            v-if="albumCover"
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
            class="relative z-[1] flex size-12 shrink-0 items-center justify-center rounded-md bg-stone-800 bg-cover bg-center transition-opacity duration-150 hover:opacity-80"
            :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
            :aria-label="`Go to ${player.currentTrack?.album || player.currentTrack?.title || 'release'}`"
          >
            <Disc3 v-if="!albumCover" :size="20" class="text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
          </NuxtLink>
          <div
            v-else
            class="relative z-[1] flex size-12 shrink-0 items-center justify-center rounded-md bg-stone-800 bg-cover bg-center"
            :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
          >
            <Disc3 v-if="!albumCover" :size="20" class="text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
          </div>
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

          <UiButton
            variant="secondary"
            icon-only
            :icon="SkipBack"
            aria-label="Previous track"
            @click="player.previous()"
          />

          <PlayerPlayPauseButton
            :playing="player.isPlaying"
            size="lg"
            highlighted
            @click="player.togglePlay()"
          />

          <UiButton
            variant="secondary"
            icon-only
            :icon="SkipForward"
            aria-label="Next track"
            @click="player.next()"
          />

          <PlayerPlaylistMenu
            :open="showPlaylistMenu"
            :playlists="playlists"
            :selected-slugs="trackPlaylistSlugs"
            placement="up"
            @toggle-open="showPlaylistMenu = !showPlaylistMenu; loadPlaylists()"
            @toggle="togglePlaylist"
            @create-new="openNewPlaylistDialog"
          />
        </div>
      </div>

      <div class="flex w-1/3 items-center justify-end gap-2">
        <VisualizerToggleButton />
        <PlayerVolumeControl />
        <PlayerClose />
      </div>
    </div>

    <PlaylistAddDialog
      v-model="showNewPlaylistDialog"
      :track-id="player.currentTrack?.id ?? null"
      @created="onPlaylistCreated"
    />

    <ReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />
  </div>
</template>
