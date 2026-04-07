<template>
  <button
    class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity"
    :class="isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
    @click.prevent="handleClick"
  >
    <LucidePause v-if="isPlaying" class="size-6" fill="currentColor" />
    <LucidePlay v-else class="size-6" fill="currentColor" />
  </button>
</template>

<script setup lang="ts">
import { LucidePlay, LucidePause } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import type { PlayerTrack } from '~/types/player'

const props = defineProps<{ playlist: PlaylistSummary }>()

const playerStore = usePlayerStore()

const isCurrent = computed(() => playerStore.currentPlaylistSlug === props.playlist.slug)
const isPlaying = computed(() => isCurrent.value && playerStore.isPlaying)

const handleClick = () => isCurrent.value ? playerStore.togglePlay() : play()

async function play() {
  try {
    const data = await $fetch<any>(`/api/playlists/${props.playlist.slug}`)
    const tracks: PlayerTrack[] = (data.tracks || []).map((pt: any) => ({
      id: pt.track.id,
      title: pt.track.title || 'Unknown',
      artist: pt.track.release?.artist?.name || 'Unknown',
      album: pt.track.release?.title || 'Unknown',
      duration: pt.track.duration || 0,
      artistSlug: pt.track.release?.artist?.slug || null,
      releaseImage: pt.track.release?.image ? `/img/releases/${pt.track.release.image}` : null,
      releaseImageUrl: pt.track.release?.imageUrl || null,
      localReleaseId: pt.track.release?.id || null,
    }))
    playerStore.playPlaylist(props.playlist.slug, tracks)
  }
  catch (error) {
    console.error('Failed to play playlist:', error)
  }
}
</script>
