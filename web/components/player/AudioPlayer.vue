<script setup lang="ts">
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Heart,
  ListMusic,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const isFavorite = ref(false)
const showPlaylistMenu = ref(false)
const playlists = ref<any[]>([])

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

function handleVolumeChange(e: Event) {
  const value = Number.parseFloat((e.target as HTMLInputElement).value)
  player.setVolume(value)
}

function getShuffleLabel() {
  const labels = {
    off: 'Shuffle: Off',
    release: 'Release',
    artist: 'Artist',
    catalogue: 'Catalogue',
  }
  return labels[player.shuffleMode]
}

function getShuffleTooltip() {
  const labels = {
    off: 'Shuffle: Off',
    release: 'Shuffle: Release',
    artist: 'Shuffle: Artist',
    catalogue: 'Shuffle: Catalogue',
  }
  return labels[player.shuffleMode]
}

async function toggleFavorite() {
  if (!player.currentTrack)
    return

  try {
    if (isFavorite.value) {
      await $fetch(`/api/favorites/tracks/${player.currentTrack.id}`, { method: 'DELETE' })
      isFavorite.value = false
    }
    else {
      await $fetch(`/api/favorites/tracks/${player.currentTrack.id}`, { method: 'POST' })
      isFavorite.value = true
    }
  }
  catch (error) {
    console.error('Failed to toggle favorite:', error)
  }
}

async function checkFavorite() {
  if (!player.currentTrack)
    return

  try {
    const favorites = await $fetch<any>('/api/favorites')
    isFavorite.value = favorites.tracks.some((fav: any) => fav.track.id === player.currentTrack?.id)
  }
  catch (error) {
    console.error('Failed to check favorite:', error)
  }
}

async function loadPlaylists() {
  try {
    playlists.value = await $fetch<any[]>('/api/playlists')
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
}

async function addToPlaylist(playlistSlug: string) {
  if (!player.currentTrack) {
    return
  }

  try {
    await $fetch(`/api/playlists/${playlistSlug}/tracks`, {
      method: 'POST',
      body: { trackId: player.currentTrack.id },
    })
    showPlaylistMenu.value = false
  }
  catch (error) {
    console.error('Failed to add to playlist:', error)
    alert('Failed to add track to playlist')
  }
}

async function createNewPlaylist() {
  const name = prompt('Enter playlist name:')
  if (!name?.trim()) {
    return
  }

  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (!slug) {
    alert('Invalid playlist name')
    return
  }

  try {
    const playlist = await $fetch<any>('/api/playlists', {
      method: 'POST',
      body: { name, slug },
    })
    await addToPlaylist(playlist.slug)
    await loadPlaylists()
  }
  catch (error) {
    console.error('Failed to create playlist:', error)
    alert('Failed to create playlist')
  }
}

watch(() => player.currentTrack?.id, () => {
  if (player.currentTrack) {
    checkFavorite()
  }
})

onMounted(() => {
  if (player.currentTrack) {
    checkFavorite()
  }
})
</script>

<template>
  <div
    v-if="player.isVisible"
    class="fixed bottom-0 left-0 z-50 flex h-20 w-full items-center border-t border-zinc-800 bg-zinc-950 px-4 lg:bottom-0"
  >
    <div class="flex w-1/4 min-w-0 items-center gap-3">
      <div
        class="size-12 shrink-0 rounded bg-zinc-800 bg-cover bg-center"
        :style="player.currentTrack?.releaseImage ? { backgroundImage: `url(${player.currentTrack.releaseImage})` } : {}"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-zinc-50">
          {{ player.currentTrack?.title || 'No track' }}
        </p>
        <p class="truncate text-xs text-zinc-400">
          {{ player.currentTrack?.artist || '' }}
        </p>
      </div>
      <button
        class="hidden lg:block text-zinc-400 hover:text-amber-500 transition-colors"
        :class="{ 'text-amber-500': isFavorite }"
        @click="toggleFavorite"
      >
        <Heart :size="18" :fill="isFavorite ? 'currentColor' : 'none'" />
      </button>
    </div>

    <div class="flex flex-1 flex-col items-center gap-1">
      <div class="flex items-center gap-4">
        <div class="relative flex flex-col items-center">
          <span
            v-if="player.shuffleMode !== 'off'"
            class="absolute -top-4 whitespace-nowrap rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-950"
          >
            {{ getShuffleLabel() }}
          </span>
          <button
            class="text-zinc-400 hover:text-zinc-50 transition-colors"
            :class="{ 'text-amber-500': player.shuffleMode !== 'off' }"
            :title="getShuffleTooltip()"
            @click="player.cycleShuffleMode()"
          >
            <Shuffle :size="18" />
          </button>
        </div>

        <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.previous()">
          <SkipBack :size="18" />
        </button>

        <button
          class="flex size-8 items-center justify-center rounded-full bg-zinc-50 text-zinc-950 hover:scale-105 transition-transform"
          @click="player.togglePlay()"
        >
          <Pause v-if="player.isPlaying" :size="16" />
          <Play v-else :size="16" class="ml-0.5" />
        </button>

        <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.next()">
          <SkipForward :size="18" />
        </button>

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
                @click="createNewPlaylist"
              >
                + Create new playlist
              </button>
              <div v-if="playlists.length > 0" class="border-t border-zinc-800 pt-2">
                <button
                  v-for="playlist in playlists"
                  :key="playlist.id"
                  class="w-full rounded px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                  @click="addToPlaylist(playlist.slug)"
                >
                  {{ playlist.name }}
                </button>
              </div>
              <div v-if="playlists.length === 0" class="px-3 py-2 text-sm text-zinc-500">
                No playlists yet
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex w-full max-w-lg items-center gap-2 text-xs text-zinc-400">
        <span class="w-10 text-right tabular-nums">{{ formatTime(player.currentTime) }}</span>
        <div
          class="group relative h-1 flex-1 cursor-pointer rounded-full bg-zinc-700"
          @click="handleProgressClick"
        >
          <div
            class="h-full rounded-full bg-zinc-50 group-hover:bg-amber-500 transition-colors"
            :style="{ width: `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%` }"
          />
        </div>
        <span class="w-10 tabular-nums">{{ formatTime(player.duration) }}</span>
      </div>
    </div>

    <div class="flex w-1/4 items-center justify-end gap-2">
      <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.toggleMute()">
        <VolumeX v-if="player.isMuted || player.volume === 0" :size="18" />
        <Volume2 v-else :size="18" />
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.isMuted ? 0 : player.volume"
        class="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-zinc-50"
        @input="handleVolumeChange"
      />
    </div>
  </div>
</template>
