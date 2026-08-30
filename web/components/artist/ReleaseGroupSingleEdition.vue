<script setup lang="ts">
import type { ReleaseGroup } from '~/types/release'
import { cx } from '~/helpers/ui'

const props = defineProps<{
  group: ReleaseGroup
  expanded: boolean
  isFavorite: boolean
  slug: string
  selectedTrackId?: string | null
}>()

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  toggleFavorite: []
  refresh: []
  info: []
  cancel: []
}>()

const connectedArtistNames = computed(() => {
  const names = new Set(props.group.releases.map(r => r.connectedArtistName).filter(Boolean) as string[])
  return [...names]
})
</script>

<template>
  <div
    :class="cx(
      'rounded-lg border border-stone-100/6 bg-stone-900 overflow-hidden',
      group.primary.status === 'MISSING' && 'bg-danger/5',
    )"
  >
    <ArtistReleaseGroupDetails
      :release="group.primary"
      :expanded="expanded"
      :is-favorite="isFavorite"
      :slug="slug"
      :selected-track-id="selectedTrackId"
      :co-artists="group.primary.coArtists"
      :connected-artist-names="connectedArtistNames"
      :track-count="group.totalTracks"
      :play-count="group.totalPlayCount"
      @toggle="emit('toggle')"
      @play="emit('play')"
      @download="emit('download')"
      @toggle-favorite="emit('toggleFavorite')"
      @refresh="emit('refresh')"
      @info="emit('info')"
      @cancel="emit('cancel')"
    />
  </div>
</template>
