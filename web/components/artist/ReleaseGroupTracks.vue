<script setup lang="ts">
import type { TrackListColumn } from '~/types/ui'

defineProps<{
  releaseId: string
  selectedTrackId?: string | null
}>()

const columns: TrackListColumn[] = [
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'playCount', label: 'Plays' },
  { key: 'duration' },
  { key: 'favorite' },
]
</script>

<template>
  <div class="border-t border-rule px-3 pb-3" @click.stop>
    <ReleaseTracksTable
      :release-id="releaseId"
      :columns="columns"
      :selected-track-id="selectedTrackId"
    />
  </div>
</template>
