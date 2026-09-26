<script setup lang="ts">
import type { CountryArtist } from '~/composables/useCountryDialog'

const open = defineModel<boolean>({ required: true })

defineProps<{
  title: string
  artists: CountryArtist[]
  loading: boolean
}>()

defineEmits<{
  'load-more': []
}>()

const { artistImage } = useImageUrl()
</script>

<template>
  <Dialog v-model="open" :title="title" size="lg">
    <template #content>
      <div class="-mx-6 -my-4 max-h-[70vh] overflow-y-auto px-6 py-4">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          <Block
            v-for="artist in artists"
            :id="artist.id"
            :key="artist.id"
            :title="artist.name"
            :image="artistImage(artist)"
            :link="`/artist/${artist.slug}`"
          />
        </div>
        <InfiniteScroll margin="100px" @load="$emit('load-more')" />
        <div v-if="loading" class="py-6 text-center text-base text-stone-100/60">
          Loading...
        </div>
        <UiEmptyState v-if="!loading && artists.length === 0" message="No artists found" />
      </div>
    </template>
  </Dialog>
</template>
