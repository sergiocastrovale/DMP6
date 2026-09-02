<script setup lang="ts">
import type { ReleaseGroup, UnifiedRelease } from '~/types/release'
import { favoriteTargetId } from '~/helpers/artistPageLogic'

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
  redownload: [release: UnifiedRelease]
  toggleFavorite: [release: UnifiedRelease]
  refresh: [release: UnifiedRelease]
  info: [release: UnifiedRelease]
  cancel: [release: UnifiedRelease]
  goToBundle: [release: UnifiedRelease]
}>()

const isSingle = computed(() => props.group.releases.length === 1)
const primaryFavoriteTargetId = computed(() => favoriteTargetId(props.group.primary))
const primaryFavorite = computed(() =>
  !!primaryFavoriteTargetId.value && props.favoriteReleases.has(primaryFavoriteTargetId.value))
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
      @redownload="emit('redownload', group.primary)"
      @toggle-favorite="emit('toggleFavorite', group.primary)"
      @refresh="emit('refresh', group.primary)"
      @info="emit('info', group.primary)"
      @cancel="emit('cancel', group.primary)"
      @go-to-bundle="emit('goToBundle', group.primary)"
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
      @redownload="emit('redownload', $event)"
      @toggle-favorite="emit('toggleFavorite', $event)"
      @refresh="emit('refresh', $event)"
      @info="emit('info', $event)"
      @cancel="emit('cancel', $event)"
      @go-to-bundle="emit('goToBundle', $event)"
    />
  </div>
</template>
