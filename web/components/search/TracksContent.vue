<script setup lang="ts">
import { Music } from 'lucide-vue-next'
import type { SearchTrack } from '~/types/search'
import type { TrackTableRow } from '~/types/track'

defineProps<{ query: string }>()
</script>

<template>
  <SearchResultsList type="tracks" :query="query" label="tracks" :empty-icon="Music">
    <template #default="{ items }">
      <TrackTable :rows="(items as SearchTrack[]).map(track => ({ id: track.id, track })) as TrackTableRow[]" />
    </template>
  </SearchResultsList>
</template>
