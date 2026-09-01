<script setup lang="ts">
import { LucideMusic } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { TrackInContext } from '~/types/common'
import type { PlayerTrack } from '~/types/player'
import { formatDuration } from '~/helpers/functions'

export interface TrackTableRow {
  id: string
  track: TrackInContext
}

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
const { releaseImage } = useImageUrl()

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
      <SlimTableRow
        v-for="row in rows"
        :key="row.id"
        :active="isCurrentTrack(row.track.id)"
        @click="handleTrackClick(row.track)"
      >
        <td class="w-10 py-2 pl-4 text-center">
          <PlayerPlayPauseButton
            :playing="isTrackPlaying(row.track.id)"
            size="sm"
            :class="isCurrentTrack(row.track.id) ? 'text-amber-400' : 'text-stone-100/55'"
          />
        </td>
        <td class="w-14 py-2 pl-2">
          <UiThumb size="sm">
            <img
              v-if="row.track.release && releaseImage(row.track.release)"
              :src="releaseImage(row.track.release)!"
              :alt="row.track.title"
              class="h-full w-full object-cover"
            >
            <div v-else class="flex h-full w-full items-center justify-center text-stone-100/20">
              <LucideMusic class="size-5" />
            </div>
          </UiThumb>
        </td>
        <td class="py-2 pl-3">
          <p
            class="truncate text-base font-medium"
            :class="isCurrentTrack(row.track.id) ? 'text-amber-400' : 'text-stone-100'"
          >
            {{ row.track.title }}
          </p>
          <div v-if="row.track.release" class="flex items-center gap-1.5 text-sm text-stone-100/55">
            <NuxtLink
              v-if="row.track.release.artist"
              :to="`/artist/${row.track.release.artist.slug}`"
              class="truncate hover:text-stone-100 transition-colors duration-150"
              @click.stop
            >
              {{ row.track.release.artist.name }}
            </NuxtLink>
            <Bullet v-if="row.track.release.artist" />
            <span class="truncate">{{ row.track.release.title }}</span>
          </div>
        </td>
        <td class="w-16 py-2 pr-4 text-center tabular-nums text-sm text-stone-100/55">
          {{ formatDuration(row.track.duration) }}
        </td>
        <td v-if="$slots.action" class="w-12 py-2 pr-4 text-center">
          <slot name="action" :row="row" />
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>

  <UiEmptyState v-else :icon="emptyIcon" :message="emptyMessage" />
</template>
