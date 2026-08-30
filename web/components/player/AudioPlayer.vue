<script setup lang="ts">
import {
  Check,
  Compass,
  ListMusic,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { formatDuration } from '~/helpers/functions'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const player = usePlayerStore()
const { resolve } = useImageUrl()

const albumCover = computed(() =>
  resolve(player.currentTrack?.releaseImage ?? null, player.currentTrack?.releaseImageUrl ?? null, 'releases'),
)
const showPlaylistMenu = ref(false)
const showNewPlaylistDialog = ref(false)
const playlists = ref<any[]>([])
const trackPlaylistSlugs = ref<Set<string>>(new Set())

function handleProgressClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  player.seek(pct * player.duration)
}

const SHUFFLE_LABELS: Record<string, string> = {
  off: 'Shuffle: Off',
  release: 'Release',
  artist: 'Artist',
  catalogue: 'Catalogue',
  explorer: 'Explorer',
}

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

const progressPct = computed(() =>
  player.duration ? (player.currentTime / player.duration) * 100 : 0,
)
</script>

<template>
  <div
    v-if="player.isVisible"
    class="flex w-full flex-col border-t border-stone-100/6 bg-stone-950 pt-3 pb-2"
  >
    <div class="flex h-16 items-center px-4">
      <div class="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:w-1/3">
        <NuxtLink
          :to="player.currentTrack?.artistSlug ? `/artist/${player.currentTrack.artistSlug}` : '#'"
          class="size-12 shrink-0 rounded-md bg-stone-800 bg-cover bg-center transition-opacity duration-150 hover:opacity-80"
          :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
        />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5 mb-0.5">
            <span class="truncate text-sm font-medium text-stone-100">{{ player.currentTrack?.title || 'No track' }}</span>
            <ToggleFavorite :size="12" />
          </div>
          <NuxtLink
            v-if="player.currentTrack?.artistSlug"
            :to="`/artist/${player.currentTrack.artistSlug}`"
            class="block truncate text-2xs text-stone-100/60 hover:text-stone-100 transition-colors duration-150"
          >
            {{ player.currentTrack?.artist || '' }}
          </NuxtLink>
          <span v-else class="block truncate text-2xs text-stone-100/60">
            {{ player.currentTrack?.artist || '' }}
          </span>
        </div>
      </div>

      <div class="flex flex-1 flex-col items-center justify-center gap-1.5">
        <div class="flex items-center gap-5">
          <div class="relative flex flex-col items-center">
            <span
              v-if="player.shuffleMode !== 'off'"
              class="absolute -top-4 whitespace-nowrap rounded-sm bg-amber-400 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-on-accent"
            >
              {{ SHUFFLE_LABELS[player.shuffleMode] }}
            </span>
            <button
              type="button"
              :class="cx('transition-colors duration-150', player.shuffleMode !== 'off' ? 'text-amber-400' : 'text-stone-100/60 hover:text-stone-100')"
              :title="SHUFFLE_TOOLTIPS[player.shuffleMode]"
              :aria-label="SHUFFLE_TOOLTIPS[player.shuffleMode]"
              @click="player.cycleShuffleMode()"
            >
              <Compass v-if="player.shuffleMode === 'explorer'" :size="18" :stroke-width="ICON_STROKE_WIDTH" />
              <Shuffle v-else :size="18" :stroke-width="ICON_STROKE_WIDTH" />
            </button>
          </div>

          <button type="button" class="text-stone-100/60 hover:text-stone-100 transition-colors duration-150" aria-label="Previous track" @click="player.previous()">
            <SkipBack :size="20" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <PlayerPlayPauseButton
            :playing="player.isPlaying"
            size="lg"
            highlighted
            @click="player.togglePlay()"
          />

          <button type="button" class="text-stone-100/60 hover:text-stone-100 transition-colors duration-150" aria-label="Next track" @click="player.next()">
            <SkipForward :size="20" :stroke-width="ICON_STROKE_WIDTH" />
          </button>

          <div class="relative">
            <button
              type="button"
              class="text-stone-100/60 hover:text-stone-100 transition-colors duration-150"
              aria-label="Add to playlist"
              aria-haspopup="menu"
              :aria-expanded="showPlaylistMenu"
              @click="showPlaylistMenu = !showPlaylistMenu; loadPlaylists()"
            >
              <ListMusic :size="18" :stroke-width="ICON_STROKE_WIDTH" />
            </button>
            <div
              v-if="showPlaylistMenu"
              role="menu"
              class="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-stone-100/10 bg-stone-900 shadow-lg"
            >
              <div class="max-h-64 overflow-y-auto p-2">
                <button
                  type="button"
                  class="mb-2 w-full rounded-md border border-stone-100/10 bg-stone-800 px-3 py-2 text-left text-sm font-medium text-amber-400 transition-colors duration-150 hover:bg-stone-700"
                  @click="openNewPlaylistDialog"
                >
                  + Create new playlist
                </button>
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
                <div v-if="playlists.length === 0" class="px-3 py-2 text-sm text-stone-100/40">
                  No playlists yet
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex w-full items-center gap-2">
          <span class="w-8 shrink-0 text-right text-2xs text-stone-100/40 tabular-nums">{{ formatDuration(player.currentTime) }}</span>
          <div
            class="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-stone-800"
            @click="handleProgressClick"
          >
            <div
              class="h-full rounded-full bg-amber-400"
              :style="{ width: `${progressPct}%` }"
            />
          </div>
          <span class="w-8 shrink-0 text-2xs text-stone-100/40 tabular-nums">{{ formatDuration(player.duration) }}</span>
        </div>
      </div>

      <div class="hidden md:flex md:w-1/3 justify-end">
        <button
          type="button"
          class="text-stone-100/40 hover:text-stone-100 transition-colors duration-150"
          title="Dismiss player"
          @click="player.dismiss()"
        >
          <X :size="18" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>
      <button
        type="button"
        class="ml-2 shrink-0 text-stone-100/40 hover:text-stone-100 transition-colors duration-150 md:hidden"
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
  </div>
</template>
