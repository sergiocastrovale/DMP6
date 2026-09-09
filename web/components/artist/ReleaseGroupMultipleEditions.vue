<script setup lang="ts">
import type { ReleaseGroup, UnifiedRelease } from '~/types/release'
import { favoriteTargetId, boxRowSubtitle, boxRowDiscLabel, isBoxSetRow } from '~/helpers/artistPageLogic'
import { cx } from '~/helpers/ui'

const props = defineProps<{
  group: ReleaseGroup
  slug: string
  expandedEdition: string | null
  favoriteReleases: Set<string>
  selectedTrackId?: string | null
  acquiringIds: Set<string>
}>()

const emit = defineEmits<{
  toggleEdition: [id: string]
  play: [edition: UnifiedRelease]
  download: [edition: UnifiedRelease]
  redownload: [edition: UnifiedRelease]
  toggleFavorite: [edition: UnifiedRelease]
  refresh: [edition: UnifiedRelease]
  info: [edition: UnifiedRelease]
  cancel: [edition: UnifiedRelease]
  goToBundle: [edition: UnifiedRelease]
}>()

const isEditionFavorite = (edition: UnifiedRelease) => {
  const target = favoriteTargetId(edition)
  return !!target && props.favoriteReleases.has(target)
}

// A dissolved box disc (boxParent set, docs/sync_decisions.md) carries no disambiguation/editionLabel
// of its own - it borrows the subtitle slot for the box's title instead, plus a separate disc-label
// slot for its position within the box.
const editionSubtitle = (edition: UnifiedRelease) =>
  boxRowSubtitle(edition) || edition.disambiguation || edition.editionLabel
</script>

<template>
  <div class="relative">
    <ArtistEditionsPill :count="group.releases.length" />
    
    <div
      :class="cx(
        'rounded-lg border border-stone-100/6 bg-stone-900 overflow-hidden',
        group.primary.status === 'MISSING' && 'bg-danger/5',
      )"
    >
      <ArtistReleaseGroupDetails
        v-for="edition in group.releases"
        :key="edition.id"
        :release="edition"
        :expanded="expandedEdition === edition.id"
        :is-favorite="isEditionFavorite(edition)"
        :slug="slug"
        :selected-track-id="expandedEdition === edition.id ? selectedTrackId : null"
        :subtitle="editionSubtitle(edition)"
        :disc-label="boxRowDiscLabel(edition)"
        :is-box-set="isBoxSetRow(edition)"
        :is-acquiring="acquiringIds.has(edition.id)"
        @toggle="emit('toggleEdition', edition.id)"
        @play="emit('play', edition)"
        @download="emit('download', edition)"
        @redownload="emit('redownload', edition)"
        @toggle-favorite="emit('toggleFavorite', edition)"
        @refresh="emit('refresh', edition)"
        @info="emit('info', edition)"
        @cancel="emit('cancel', edition)"
        @go-to-bundle="emit('goToBundle', edition)"
      />
    </div>
  </div>
</template>
