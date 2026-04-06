<script setup lang="ts">
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Compass,
  ListMusic,
  Check,
  X,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const { resolve } = useImageUrl()

const albumCover = computed(() =>
  resolve(player.currentTrack?.releaseImage ?? null, player.currentTrack?.releaseImageUrl ?? null, 'releases'),
)
const showPlaylistMenu = ref(false)
const showNewPlaylistDialog = ref(false)
const playlists = ref<any[]>([])
const trackPlaylistSlugs = ref<Set<string>>(new Set())

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds))
    return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function handleProgressClick(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  player.seek(pct * player.duration)
}

function getShuffleLabel() {
  const labels: Record<string, string> = {
    off: 'Shuffle: Off',
    release: 'Release',
    artist: 'Artist',
    catalogue: 'Catalogue',
    explorer: 'Explorer',
  }
  return labels[player.shuffleMode]
}

function getShuffleTooltip() {
  const labels: Record<string, string> = {
    off: 'Shuffle: Off',
    release: 'Shuffle: Release',
    artist: 'Shuffle: Artist',
    catalogue: 'Shuffle: Catalogue',
    explorer: 'Explorer mode — click to turn off',
  }
  return labels[player.shuffleMode]
}

async function loadPlaylists() {
  try {
    const [all, slugs] = await Promise.all([
      $fetch<any[]>('/api/playlists'),
      player.currentTrack
        ? $fetch<string[]>(`/api/tracks/${player.currentTrack.id}/playlists`)
        : Promise.resolve([]),
    ])
    playlists.value = all.filter((p: any) => p.type !== 'GENRE')
    trackPlaylistSlugs.value = new Set(slugs)
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
}

async function togglePlaylist(playlistSlug: string) {
  if (!player.currentTrack)
    return
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
    class="fixed bottom-0 left-0 z-50 flex w-full flex-col border-t border-zinc-800 bg-zinc-950 pt-3 pb-2"
  >
    <!-- Controls row -->
    <div class="flex h-16 items-center px-4">
      <!-- Track Info -->
      <div class="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:w-1/3">
        <NuxtLink
          :to="player.currentTrack?.artistSlug ? `/artist/${player.currentTrack.artistSlug}` : '#'"
          class="size-12 shrink-0 rounded bg-zinc-800 bg-cover bg-center transition-opacity hover:opacity-80"
          :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
        />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5 mb-0.5">
            <span class="truncate text-sm font-medium text-zinc-50">{{ player.currentTrack?.title || 'No track' }}</span>
            <ToggleFavorite :size="12" />
          </div>
          <NuxtLink
            v-if="player.currentTrack?.artistSlug"
            :to="`/artist/${player.currentTrack.artistSlug}`"
            class="block truncate text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {{ player.currentTrack?.artist || '' }}
          </NuxtLink>
          <span v-else class="block truncate text-[10px] text-zinc-400">
            {{ player.currentTrack?.artist || '' }}
          </span>
        </div>
      </div>

      <!-- Playback Controls -->
      <div class="flex flex-1 flex-col items-center justify-center gap-1.5">
        <!-- Buttons row -->
        <div class="flex items-center gap-5">
          <!-- Shuffle -->
          <div class="relative flex flex-col items-center">
            <span
              v-if="player.shuffleMode !== 'off'"
              class="absolute -top-4 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-950"
              :class="player.shuffleMode === 'explorer' ? 'bg-amber-400' : 'bg-amber-500'"
            >
              {{ getShuffleLabel() }}
            </span>
            <button
              class="transition-colors"
              :class="player.shuffleMode !== 'off' ? 'text-amber-500 hover:text-amber-400' : 'text-zinc-400 hover:text-zinc-50'"
              :title="getShuffleTooltip()"
              @click="player.cycleShuffleMode()"
            >
              <Compass v-if="player.shuffleMode === 'explorer'" :size="18" />
              <Shuffle v-else :size="18" />
            </button>
          </div>

          <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.previous()">
            <SkipBack :size="20" />
          </button>

          <button
            class="flex size-11 items-center justify-center rounded-full bg-zinc-50 text-zinc-950 hover:scale-105 transition-transform"
            @click="player.togglePlay()"
          >
            <Pause v-if="player.isPlaying" :size="20" />
            <Play v-else :size="20" class="ml-0.5" />
          </button>

          <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.next()">
            <SkipForward :size="20" />
          </button>

          <!-- Playlist menu -->
          <div class="relative">
            <button
              class="text-zinc-400 hover:text-zinc-50 transition-colors"
              @click="showPlaylistMenu = !showPlaylistMenu; loadPlaylists()"
            >
              <ListMusic :size="18" />
            </button>
            <div
              v-if="showPlaylistMenu"
              class="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            >
              <div class="max-h-64 overflow-y-auto p-2">
                <button
                  class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm font-medium text-amber-500 hover:bg-zinc-700 transition-colors mb-2"
                  @click="openNewPlaylistDialog"
                >
                  + Create new playlist
                </button>
                <div v-if="playlists.length > 0" class="border-t border-zinc-800 pt-2">
                  <button
                    v-for="playlist in playlists"
                    :key="playlist.id"
                    class="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors"
                    :class="trackPlaylistSlugs.has(playlist.slug) ? 'text-amber-500 hover:bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800'"
                    @click="togglePlaylist(playlist.slug)"
                  >
                    {{ playlist.name }}
                    <Check v-if="trackPlaylistSlugs.has(playlist.slug)" :size="14" />
                  </button>
                </div>
                <div v-if="playlists.length === 0" class="px-3 py-2 text-sm text-zinc-500">
                  No playlists yet
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="flex w-full items-center gap-2">
          <span class="w-8 shrink-0 text-right text-[10px] text-zinc-500 tabular-nums">{{ formatTime(player.currentTime) }}</span>
          <div
            class="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-zinc-800"
            @click="handleProgressClick"
          >
            <div
              class="h-full rounded-full"
              :style="{
                width: `${progressPct}%`,
                background: 'linear-gradient(to right, #d97706, #fbbf24, #f59e0b)',
              }"
            />
          </div>
          <span class="w-8 shrink-0 text-[10px] text-zinc-500 tabular-nums">{{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <!-- Spacer + Dismiss -->
      <div class="hidden md:flex md:w-1/3 justify-end">
        <button
          class="text-zinc-500 hover:text-zinc-50 transition-colors"
          title="Dismiss player"
          @click="player.dismiss()"
        >
          <X :size="18" />
        </button>
      </div>
      <button
        class="ml-2 shrink-0 text-zinc-500 hover:text-zinc-50 transition-colors md:hidden"
        title="Dismiss player"
        @click="player.dismiss()"
      >
        <X :size="18" />
      </button>
    </div>

    <PlaylistAddDialog
      v-model="showNewPlaylistDialog"
      :track-id="player.currentTrack?.id ?? null"
      @created="onPlaylistCreated"
    />
  </div>
</template>
