<script setup lang="ts">
import { layout } from '~/helpers/ui'

definePageMeta({ middleware: 'sync-run' })
useTitle('Add artist')
</script>

<template>
  <div :class="layout.page" class="lg:my-6 my-1">
    <PageTitle text="Add artist" subtext="Search MusicBrainz and add an artist to your library. You can also add artists manually by pasting in their MusicBrainz ID." />
    <ArtistAddSearch />
  </div>
</template>
