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
  Radio,
} from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
const config = useRuntimeConfig()
const { isStreamMode } = useStreamMode()
const isFavorite = ref(false)
const showPlaylistMenu = ref(false)
const playlists = ref<any[]>([])

const listener = isStreamMode.value ? usePartyListener() : null
const listenerCount = ref(0)
const isPartyEnabled = computed(() => config.public.partyEnabled)
const isHost = computed(() => config.public.partyRole === 'host')

// In stream mode, auto-connect to the stream and poll for listener count
if (import.meta.client && isStreamMode.value && listener) {
  onMounted(async () => {
    try {
      const status = await $fetch<any>('/api/party/status')
      if (status.active) {
        listener.connect()
        listenerCount.value = status.listenerCount || 0
      }
    }
    catch { /* no active session */ }
  })

  // Poll for session availability and listener count
  const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
  onMounted(() => {
    pollTimer.value = setInterval(async () => {
      try {
        const status = await $fetch<any>('/api/party/status')
        if (status.active) {
          listenerCount.value = status.listenerCount || 0
          if (!listener.isConnected.value && !listener.isReconnecting.value) {
            listener.connect()
          }
        }
        else {
          listenerCount.value = 0
        }
      }
      catch { /* ignore */ }
    }, 5000)
  })
  onBeforeUnmount(() => {
    if (pollTimer.value) clearInterval(pollTimer.value)
  })
}

// Stream-mode display values
const displayTrack = computed(() => {
  if (isStreamMode.value && listener) {
    const t = listener.currentTrack.value
    if (!t) return null
    return {
      title: t.title,
      artist: t.artist,
      coverPath: t.coverPath,
    }
  }
  return player.currentTrack ? {
    title: player.currentTrack.title,
    artist: player.currentTrack.artist,
    coverPath: player.currentTrack.releaseImage,
  } : null
})

const displayTime = computed(() => isStreamMode.value && listener ? listener.currentTime.value : player.currentTime)
const displayDuration = computed(() => isStreamMode.value && listener ? listener.duration.value : player.duration)
const displayPlaying = computed(() => isStreamMode.value && listener ? listener.isPlaying.value : player.isPlaying)
const showPlayer = computed(() => {
  if (isStreamMode.value) {
    return listener?.isConnected.value || listener?.isReconnecting.value
  }
  return player.isVisible
})

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds))
    return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function handleProgressClick(e: MouseEvent) {
  if (isStreamMode.value) return
  const bar = e.currentTarget as HTMLElement
  const rect = bar.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  player.seek(pct * player.duration)
}

function handleVolumeChange(e: Event) {
  const value = Number.parseFloat((e.target as HTMLInputElement).value)
  if (isStreamMode.value && listener) {
    listener.setVolume(value)
  }
  else {
    player.setVolume(value)
  }
}

function handleTogglePlay() {
  if (isStreamMode.value && listener) {
    listener.togglePlay()
  }
  else {
    player.togglePlay()
  }
}

function handleToggleMute() {
  if (isStreamMode.value && listener) {
    listener.toggleMute(!player.isMuted)
  }
  else {
    player.toggleMute()
  }
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
  if (player.currentTrack && !isStreamMode.value) {
    checkFavorite()
  }
})

onMounted(() => {
  if (player.currentTrack && !isStreamMode.value) {
    checkFavorite()
  }
})
</script>

<template>
  <div
    v-if="showPlayer"
    class="fixed bottom-0 left-0 z-50 flex h-20 w-full items-center border-t border-zinc-800 bg-zinc-950 px-4 lg:bottom-0"
  >
    <!-- Track Info -->
    <div class="flex w-1/4 min-w-0 items-center gap-3">
      <div
        class="size-12 shrink-0 rounded bg-zinc-800 bg-cover bg-center"
        :style="displayTrack?.coverPath ? { backgroundImage: `url(${displayTrack.coverPath})` } : {}"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-zinc-50">
          {{ displayTrack?.title || 'No track' }}
        </p>
        <p class="truncate text-xs text-zinc-400">
          {{ displayTrack?.artist || '' }}
        </p>
      </div>
      <!-- Favorite (host only) -->
      <button
        v-if="!isStreamMode"
        class="hidden lg:block text-zinc-400 hover:text-amber-500 transition-colors"
        :class="{ 'text-amber-500': isFavorite }"
        @click="toggleFavorite"
      >
        <Heart :size="18" :fill="isFavorite ? 'currentColor' : 'none'" />
      </button>
      <!-- Stream indicator for listeners -->
      <div
        v-if="isStreamMode && listener?.isConnected.value"
        class="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-500"
      >
        <Radio :size="12" />
        <span>Live</span>
      </div>
    </div>

    <!-- Playback Controls -->
    <div class="flex flex-1 flex-col items-center gap-1">
      <div class="flex items-center gap-4">
        <!-- Shuffle (host only) -->
        <div v-if="!isStreamMode" class="relative flex flex-col items-center">
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

        <!-- Previous (host only) -->
        <button v-if="!isStreamMode" class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.previous()">
          <SkipBack :size="18" />
        </button>

        <!-- Play/Pause (both modes) -->
        <button
          class="flex size-8 items-center justify-center rounded-full bg-zinc-50 text-zinc-950 hover:scale-105 transition-transform"
          @click="handleTogglePlay"
        >
          <Pause v-if="displayPlaying" :size="16" />
          <Play v-else :size="16" class="ml-0.5" />
        </button>

        <!-- Next (host only) -->
        <button v-if="!isStreamMode" class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="player.next()">
          <SkipForward :size="18" />
        </button>

        <!-- Playlist menu (host only) -->
        <div v-if="!isStreamMode" class="relative">
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

        <!-- Party button (host only, when party enabled) -->
        <NuxtLink
          v-if="isPartyEnabled && isHost"
          to="/party"
          class="text-zinc-400 hover:text-zinc-50 transition-colors"
          title="Music Party"
        >
          <Radio :size="18" />
        </NuxtLink>
      </div>

      <!-- Progress Bar -->
      <div class="flex w-full max-w-lg items-center gap-2 text-xs text-zinc-400">
        <span class="w-10 text-right tabular-nums">{{ formatTime(displayTime) }}</span>
        <div
          class="group relative h-1 flex-1 rounded-full bg-zinc-700"
          :class="isStreamMode ? 'cursor-default' : 'cursor-pointer'"
          @click="handleProgressClick"
        >
          <div
            class="h-full rounded-full bg-zinc-50 transition-colors"
            :class="isStreamMode ? '' : 'group-hover:bg-amber-500'"
            :style="{ width: `${displayDuration ? (displayTime / displayDuration) * 100 : 0}%` }"
          />
        </div>
        <span class="w-10 tabular-nums">{{ formatTime(displayDuration) }}</span>
      </div>
    </div>

    <!-- Volume -->
    <div class="flex w-1/4 flex-col items-end justify-center gap-1">
      <div class="flex items-center gap-2">
        <button class="text-zinc-400 hover:text-zinc-50 transition-colors" @click="handleToggleMute">
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
      <div v-if="isStreamMode && listenerCount > 0" class="text-[10px] text-zinc-500">
        {{ listenerCount }} {{ listenerCount === 1 ? 'user' : 'users' }} connected
      </div>
    </div>
  </div>
</template>
