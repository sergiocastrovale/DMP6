<script setup lang="ts">
import { LucideMusic } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { TrackInContext } from '~/types/common'
import type { PlayerTrack } from '~/types/player'
import type { TrackTableRow } from '~/types/track'

const props = withDefaults(defineProps<{
  rows: TrackTableRow[]
  emptyMessage?: string
  emptyIcon?: Component
}>(), {
  emptyMessage: 'No tracks yet',
  emptyIcon: () => LucideMusic,
})

defineSlots<{ action?: (props: { row: TrackTableRow }) => any }>()

const playerStore = usePlayerStore()

const toPlayerTrack = (track: TrackInContext): PlayerTrack => ({
  id: track.id,
  title: track.title,
  artist: track.release?.artist?.name ?? '',
  album: track.release?.title ?? '',
  duration: track.duration ?? 0,
  artistSlug: track.release?.artist?.slug ?? null,
  releaseImage: track.release?.image ?? null,
  releaseImageUrl: track.release?.imageUrl ?? null,
  localReleaseId: track.release?.id ?? null,
})

const isCurrentTrack = (trackId: string) => playerStore.currentTrack?.id === trackId
const isTrackPlaying = (trackId: string) => playerStore.isPlaying && isCurrentTrack(trackId)

// Every row shares one queue - the whole table, in its given order - so next/previous on the
// mini-player walks the same list the user sees here, not just the single row that was clicked.
const handleTrackClick = (track: TrackInContext) => {
  if (isCurrentTrack(track.id)) {
    playerStore.togglePlay()
    return
  }
  const queue = props.rows.map(row => toPlayerTrack(row.track))
  const start = queue.find(t => t.id === track.id)
  playerStore.setQueue(queue, start)
}
</script>

<template>
  <SlimTable v-if="rows.length > 0">
    <SlimTableBody>
      <ArtistsTrackRow
        v-for="row in rows"
        :key="row.id"
        :track="row.track"
        :playing="isTrackPlaying(row.track.id)"
        :current="isCurrentTrack(row.track.id)"
        @click="handleTrackClick(row.track)"
      >
        <template v-if="$slots.action" #action>
          <slot name="action" :row="row" />
        </template>
      </ArtistsTrackRow>
    </SlimTableBody>
  </SlimTable>

  <UiEmptyState v-else :icon="emptyIcon" :message="emptyMessage" />
</template>
