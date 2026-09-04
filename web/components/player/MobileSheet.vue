<script setup lang="ts">
import { ChevronDown, Compass, Disc3, Info, Shuffle, SkipBack, SkipForward } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, transitions, typography } from '~/helpers/ui'
import { SHUFFLE_CONTEXT_LABELS, SHUFFLE_TOOLTIPS } from '~/helpers/constants'

const emit = defineEmits<{ close: [] }>()

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

const contextLabel = computed(() => SHUFFLE_CONTEXT_LABELS[player.shuffleMode])

const sheetRef = ref<HTMLElement>()
// The parent only removes this whole component from the tree once the leave transition has
// actually finished (see @after-leave below). Flipping isOpen false first - rather than the
// parent yanking the component out via v-if directly - is required for the slide-down to play at
// all: <Transition> only detects enter/leave on a v-if/v-show toggle of ITS OWN child while it
// stays mounted; if the owning component is torn down first, Vue never runs the leave hooks.
// useFocusTrap also relies on this: it restores focus to the trigger from its own watch(active)
// callback when isOpen goes true -> false, which only fires if the component is still around to
// see the change.
const isOpen = ref(true)
const requestClose = () => { isOpen.value = false }

useFocusTrap(sheetRef, isOpen)
useHistoryDismiss(requestClose)

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    requestClose()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition appear v-bind="transitions.slideUp" @after-leave="emit('close')">
      <div
        v-if="isOpen"
        id="player-sheet"
        ref="sheetRef"
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        data-testid="player-sheet"
        class="fixed inset-0 z-[45] flex flex-col bg-stone-950 lg:hidden"
      >
        <div class="flex items-center justify-between px-4 pt-3 pb-1">
          <UiButton
            variant="ghost"
            icon-only
            :icon="ChevronDown"
            aria-label="Collapse player"
            @click="requestClose"
          />
          <VisualizerToggleButton variant="ghost" size="md" />
        </div>

        <div class="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-4">
          <div class="flex w-full max-w-[min(78vw,380px)] aspect-square items-center justify-center overflow-hidden rounded-xl bg-stone-800">
            <img v-if="albumCover" :src="albumCover" :alt="player.currentTrack?.album ?? ''" class="size-full object-cover">
            <Disc3 v-else :size="64" class="text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
          </div>

          <div class="flex w-full max-w-[min(78vw,380px)] flex-col gap-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p :class="cx(typography.title, 'truncate text-stone-100')">
                  {{ player.currentTrack?.title || 'No track' }}
                </p>
                <NuxtLink
                  v-if="player.currentTrack?.artistSlug"
                  :to="`/artist/${player.currentTrack.artistSlug}`"
                  class="truncate text-sm text-stone-100/55 hover:text-stone-100 transition-colors duration-150"
                >
                  {{ player.currentTrack?.artist }}
                </NuxtLink>
                <p v-else class="truncate text-sm text-stone-100/55">{{ player.currentTrack?.artist }}</p>
              </div>
              <ToggleFavorite :size="22" always-visible />
            </div>

            <PlayerSeekBar
              large
              :current-time="player.currentTime"
              :duration="player.duration"
              @seek="(time) => player.seek(time)"
            />

            <div class="flex items-center justify-center gap-4">
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
                size="xl"
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
            </div>

            <div class="flex items-center justify-center gap-3">
              <PlayerPlaylistMenu
                :open="showPlaylistMenu"
                :playlists="playlists"
                :selected-slugs="trackPlaylistSlugs"
                placement="down"
                @toggle-open="showPlaylistMenu = !showPlaylistMenu; loadPlaylists()"
                @toggle="togglePlaylist"
                @create-new="openNewPlaylistDialog"
              />
              <UiButton
                variant="secondary"
                icon-only
                :icon="Info"
                :disabled="!player.currentTrack?.localReleaseId"
                aria-label="Release info"
                @click="openTrackInfo"
              />
              <PlayerClose />
            </div>

            <PlayerVolumeControl fluid />
          </div>
        </div>

        <PlaylistAddDialog
          v-model="showNewPlaylistDialog"
          :track-id="player.currentTrack?.id ?? null"
          @created="onPlaylistCreated"
        />

        <ReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />
      </div>
    </Transition>
  </Teleport>
</template>
