<script setup lang="ts">
import { ArrowLeft, Loader2 } from 'lucide-vue-next'

const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { data: artist, pending, error } = useFetch(() => `/api/artists/${slug.value}`, {
  key: `artist-${slug.value}`,
})
</script>

<template>
  <div>
    <!-- Back button -->
    <NuxtLink to="/browse" class="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-50 transition-colors">
      <ArrowLeft :size="16" />
      Back to browse
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-zinc-50">Artist not found</p>
      <p class="mt-1 text-sm text-zinc-400">The artist you're looking for doesn't exist.</p>
    </div>

    <!-- Content -->
    <div v-else-if="artist" class="flex flex-col gap-8">
      <ArtistHeader :artist="artist as any" />
      <ArtistReleases :releases="(artist as any).releases" />
    </div>
  </div>
</template>
