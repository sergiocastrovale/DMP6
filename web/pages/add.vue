<script setup lang="ts">
import { layout } from '~/helpers/ui'

definePageMeta({ middleware: 'sync-run' })
useTitle('Add artist')
</script>

<template>
  <div :class="layout.page">
    <PageTitle text="Add artist" subtext="Search MusicBrainz and add an artist to your library" />
    <ArtistAddSearch />
  </div>
</template>
