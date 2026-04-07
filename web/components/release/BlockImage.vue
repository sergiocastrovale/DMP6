<template>
  <template v-if="type === 'multiple'">
    <PlaylistBlockImageMosaic :images="coverImages!" />
  </template>
  <template v-else>
    <img
      v-if="imageUrl"
      :src="imageUrl"
      :alt="release!.title"
      loading="lazy"
      class="h-full w-full object-cover transition-transform group-hover:scale-105"
    >
    <div
      v-else
      class="flex h-full w-full items-center justify-center text-zinc-600"
    >
      <LucideMusic class="size-12" />
    </div>
  </template>
</template>

<script setup lang="ts">
import { LucideMusic } from 'lucide-vue-next'
import type { Release } from '~/types/release'

const props = withDefaults(defineProps<{
  type?: 'single' | 'multiple'
  release?: Release
  coverImages?: Array<{ image: string | null; imageUrl: string | null }>
}>(), {
  type: 'single',
  release: undefined,
  coverImages: undefined,
})

const { releaseImage } = useImageUrl()

const imageUrl = computed(() => props.release ? releaseImage(props.release) : null)
</script>
