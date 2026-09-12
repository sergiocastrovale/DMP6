<script setup lang="ts">
import { Disc } from 'lucide-vue-next'
import type { SearchRelease } from '~/types/search'
import { grid } from '~/helpers/ui'

defineProps<{ query: string }>()

const { releaseImage } = useImageUrl()
</script>

<template>
  <SearchResultsList type="releases" :query="query" label="releases" :empty-icon="Disc">
    <template #default="{ items }">
      <div :class="grid.auto">
        <Block
          v-for="release in items as SearchRelease[]"
          :id="release.id"
          :key="release.id"
          :title="release.title"
          :title-link="release.artist ? `/artist/${release.artist.slug}?releaseId=${release.id}` : undefined"
          :subtitle="release.artist?.name"
          :subtitle-link="release.artist ? `/artist/${release.artist.slug}` : undefined"
          :year="release.year"
          :image="releaseImage(release)"
          :playable="!!release.artist"
          :release-id="release.id"
          :artist-slug="release.artist?.slug"
        />
      </div>
    </template>
  </SearchResultsList>
</template>
