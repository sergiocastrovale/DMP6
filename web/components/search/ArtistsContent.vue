<script setup lang="ts">
import { User } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import { grid } from '~/helpers/ui'

defineProps<{ query: string }>()

const { artistImage } = useImageUrl()
</script>

<template>
  <SearchResultsList type="artists" :query="query" label="artists" :empty-icon="User">
    <template #default="{ items }">
      <div :class="grid.auto">
        <Block
          v-for="artist in items as Artist[]"
          :id="artist.id"
          :key="artist.id"
          :title="artist.name"
          :link="`/artist/${artist.slug}`"
          :image="artistImage(artist)"
        />
      </div>
    </template>
  </SearchResultsList>
</template>
