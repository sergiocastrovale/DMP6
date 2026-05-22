<script setup lang="ts">
import { LucideListMusic } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'

const props = defineProps<{ playlist: PlaylistSummary }>()

const { resolve } = useImageUrl()

const firstCover = computed(() => {
  const img = props.playlist.coverImages[0]
  return img ? resolve(img.image, img.imageUrl, 'releases') : null
})
</script>

<template>
  <NuxtLink
    :to="`/playlists/${playlist.slug}`"
    class="flex items-center gap-4 px-3 py-2.5 border-b border-rule hover:bg-bg-1 transition-colors cursor-pointer"
  >
    <div class="relative size-[52px] shrink-0 overflow-hidden rounded-cover bg-bg-2">
      <img
        v-if="firstCover"
        :src="firstCover"
        :alt="playlist.name"
        class="w-full h-full object-cover"
      />
      <div v-else class="flex h-full w-full items-center justify-center text-ink-4">
        <LucideListMusic :size="20" />
      </div>
    </div>

    <div class="flex-1 min-w-0">
      <div class="font-semibold text-sm text-ink truncate">{{ playlist.name }}</div>
      <div class="text-card-artist text-ink-2 truncate">
        {{ playlist.trackCount }} {{ playlist.trackCount === 1 ? 'track' : 'tracks' }}
      </div>
    </div>

    <div class="font-mono text-meta-lg text-ink-3 tracking-[0.04em] uppercase shrink-0">
      {{ playlist.type }}
    </div>
  </NuxtLink>
</template>
