<script setup lang="ts">
import { LucideHeart, LucideDisc, LucidePlay, LucidePause } from 'lucide-vue-next'
import type { FavoriteRelease } from '~/types/favorites'

defineProps<{
  releases: FavoriteRelease[]
}>()

const emit = defineEmits<{
  unfavorite: [releaseId: string]
}>()

const { releaseImage } = useImageUrl()
const { isCurrentRelease, isReleasePlaying, toggleOrPlay } = usePlayRelease()
const { hasPerm } = useAuth()
const canCrud = hasPerm('favorites.crud')
</script>

<template>
  <div
    v-if="releases.length > 0"
    class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
  >
    <div
      v-for="fav in releases"
      :key="fav.id"
      class="group relative flex flex-col gap-2"
    >
      <button
        v-if="canCrud"
        class="absolute right-2 top-2 z-10 rounded-full bg-bg-1/90 p-1.5 text-accent opacity-0 transition-opacity group-hover:opacity-100"
        @click="emit('unfavorite', fav.release.id)"
      >
        <LucideHeart class="size-4" fill="currentColor" />
      </button>

      <div class="relative aspect-square overflow-hidden rounded-lg bg-bg-2">
        <img
          v-if="releaseImage(fav.release)"
          :src="releaseImage(fav.release)!"
          :alt="fav.release.title"
          class="h-full w-full object-cover transition-transform group-hover:scale-105"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
          <LucideDisc class="size-12" />
        </div>

        <button
          class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity"
          :class="isCurrentRelease(fav.release.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          @click="toggleOrPlay(fav.release.id)"
        >
          <div class="rounded-full bg-accent p-3 text-accent-ink shadow-lg">
            <LucidePause v-if="isReleasePlaying(fav.release.id)" class="size-6" fill="currentColor" />
            <LucidePlay v-else class="size-6" fill="currentColor" />
          </div>
        </button>
      </div>

      <div class="flex flex-col gap-0.5">
        <p class="line-clamp-1 text-sm font-medium text-ink">
          {{ fav.release.title }}
        </p>
        <NuxtLink
          v-if="fav.release.artist"
          :to="`/artist/${fav.release.artist.slug}`"
          class="line-clamp-1 text-xs text-ink-2 hover:text-ink-2 transition-colors"
        >
          {{ fav.release.artist.name }}
        </NuxtLink>
        <p v-if="fav.release.year" class="text-xs text-ink0">
          {{ fav.release.year }}
        </p>
      </div>
    </div>
  </div>

  <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
    <LucideDisc class="mb-3 size-12 opacity-50" />
    <p>No favorite releases yet</p>
    <NuxtLink to="/browse" class="mt-4 text-sm text-accent hover:text-accent transition-colors">
      Browse releases
    </NuxtLink>
  </div>
</template>
