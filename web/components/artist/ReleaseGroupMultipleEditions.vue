<script setup lang="ts">
import type { ReleaseGroup, UnifiedRelease } from '~/types/release'
import { cx } from '~/helpers/ui'

defineProps<{
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
  toggleFavorite: [edition: UnifiedRelease]
  refresh: [edition: UnifiedRelease]
  info: [edition: UnifiedRelease]
  cancel: [edition: UnifiedRelease]
}>()
</script>

<template>
  <div class="relative">
    <span
      class="absolute right-full top-12 translate-x-[23px] -translate-y-1/2 -rotate-90 whitespace-nowrap rounded-sm rounded-b-none border border-b-0 border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-2xs font-medium text-amber-400"
    >{{ group.releases.length }} editions</span>
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
        :is-favorite="!!edition.localReleaseId && favoriteReleases.has(edition.localReleaseId)"
        :slug="slug"
        :selected-track-id="expandedEdition === edition.id ? selectedTrackId : null"
        :subtitle="edition.disambiguation || edition.editionLabel"
        :is-acquiring="acquiringIds.has(edition.id)"
        @toggle="emit('toggleEdition', edition.id)"
        @play="emit('play', edition)"
        @download="emit('download', edition)"
        @toggle-favorite="emit('toggleFavorite', edition)"
        @refresh="emit('refresh', edition)"
        @info="emit('info', edition)"
        @cancel="emit('cancel', edition)"
      />
    </div>
  </div>
</template>
