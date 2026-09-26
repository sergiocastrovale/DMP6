<template>
  <div
    class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-150"
    :class="isPlaying ? 'opacity-100' : 'opacity-0 group-hover/cover:opacity-100'"
    @click.prevent="handleClick"
  >
    <PlayerPlayPauseButton
      :playing="isPlaying"
      size="lg"
      :highlighted="isPlaying"
      class="text-stone-100"
    />
  </div>
</template>

<script setup lang="ts">
import { playlistTrackToPlayerTrack } from '~/helpers/playerTrack'
import type { PlaylistSummary } from '~/types/playlist'
import type { PlayerTrack } from '~/types/player'

const props = defineProps<{ playlist: PlaylistSummary }>()

const playerStore = usePlayerStore()
const api = useApi()

const isCurrent = computed(() => playerStore.currentPlaylistSlug === props.playlist.slug)
const isPlaying = computed(() => isCurrent.value && playerStore.isPlaying)

const handleClick = () => isCurrent.value ? playerStore.togglePlay() : play()

const play = async () => {
  try {
    const data = await $fetch<any>(`/api/playlists/${props.playlist.slug}`)
    const tracks: PlayerTrack[] = (data.tracks || []).map((pt: any) => playlistTrackToPlayerTrack(pt.track))
    playerStore.playPlaylist(props.playlist.slug, tracks)
  }
  catch (e) {
    api.report(e, 'Could not play the playlist')
  }
}
</script>
