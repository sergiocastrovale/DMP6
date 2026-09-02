<script setup lang="ts">
import type { ReleaseGroup, UnifiedRelease } from '~/types/release'

const props = defineProps<{
  group: ReleaseGroup
  slug: string
  expandedGroup: string | null
  expandedEdition: string | null
  favoriteReleases: Set<string>
  selectedTrackId?: string | null
  acquiringIds: Set<string>
}>()

const emit = defineEmits<{
  toggleGroup: [key: string]
  toggleEdition: [id: string]
  play: [release: UnifiedRelease]
  download: [release: UnifiedRelease]
  toggleFavorite: [release: UnifiedRelease]
  refresh: [release: UnifiedRelease]
  info: [release: UnifiedRelease]
  cancel: [release: UnifiedRelease]
}>()

const isSingle = computed(() => props.group.releases.length === 1)
const primaryFavorite = computed(() =>
  !!props.group.primary.localReleaseId && props.favoriteReleases.has(props.group.primary.localReleaseId))
</script>

<template>
  <div :data-group-key="group.key" class="relative my-2">
    <ArtistReleaseGroupSingleEdition
      v-if="isSingle"
      :group="group"
      :expanded="expandedGroup === group.key"
      :is-favorite="primaryFavorite"
      :slug="slug"
      :selected-track-id="selectedTrackId"
      :is-acquiring="acquiringIds.has(group.primary.id)"
      @toggle="emit('toggleGroup', group.key)"
      @play="emit('play', group.primary)"
      @download="emit('download', group.primary)"
      @toggle-favorite="emit('toggleFavorite', group.primary)"
      @refresh="emit('refresh', group.primary)"
      @info="emit('info', group.primary)"
      @cancel="emit('cancel', group.primary)"
    />
    <ArtistReleaseGroupMultipleEditions
      v-else
      :group="group"
      :slug="slug"
      :expanded-edition="expandedEdition"
      :favorite-releases="favoriteReleases"
      :selected-track-id="selectedTrackId"
      :acquiring-ids="acquiringIds"
      @toggle-edition="emit('toggleEdition', $event)"
      @play="emit('play', $event)"
      @download="emit('download', $event)"
      @toggle-favorite="emit('toggleFavorite', $event)"
      @refresh="emit('refresh', $event)"
      @info="emit('info', $event)"
      @cancel="emit('cancel', $event)"
    />
  </div>
</template>
