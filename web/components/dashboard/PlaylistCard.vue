<script setup lang="ts">
import { LucideListMusic, LucideMusic } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{ playlist: PlaylistSummary }>()

const { resolve } = useImageUrl()

const covers = computed(() => props.playlist.coverImages.slice(0, 4))
const hasCovers = computed(() => covers.value.length > 0)

const coverImageUrl = (cover: { image: string | null, imageUrl: string | null }) =>
  resolve(cover.image, cover.imageUrl, 'releases')
</script>

<template>
  <NuxtLink
    :to="`/playlists/${playlist.slug}`"
    class="cursor-pointer flex flex-col gap-3 group"
  >
    <div class="aspect-square relative overflow-hidden rounded-lg bg-stone-800 border border-stone-100/6 transition-colors duration-150 group-hover:border-stone-100/10">
      <div
        v-if="hasCovers"
        class="grid h-full w-full transition-transform duration-400 group-hover:scale-[1.04]"
        :class="covers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'"
      >
        <div
          v-for="(cover, idx) in covers"
          :key="idx"
          class="relative overflow-hidden bg-stone-700"
        >
          <img
            v-if="coverImageUrl(cover)"
            :src="coverImageUrl(cover)!"
            alt=""
            loading="lazy"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-stone-100/30">
            <LucideMusic class="size-8" :stroke-width="ICON_STROKE_WIDTH" />
          </div>
        </div>
      </div>
      <div v-else class="flex h-full w-full items-center justify-center text-stone-100/30">
        <LucideListMusic class="size-12" :stroke-width="ICON_STROKE_WIDTH" />
      </div>
    </div>
    <div class="flex flex-col gap-0.5 min-w-0">
      <div class="font-display font-semibold text-lg text-stone-100 truncate">
        {{ playlist.name }}
      </div>
      <div class="font-mono text-2xs uppercase text-stone-100/30 tracking-[0.04em]">
        {{ playlist.trackCount }} {{ playlist.trackCount === 1 ? 'track' : 'tracks' }}
      </div>
    </div>
  </NuxtLink>
</template>
