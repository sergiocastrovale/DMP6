<script setup lang="ts">
import { LucideMusic, LucideListMusic } from 'lucide-vue-next'

defineProps<{
  coverImages: Array<{ image: string | null; imageUrl: string | null }>
}>()

const { resolve } = useImageUrl()

function coverImageUrl(cover: { image: string | null; imageUrl: string | null }) {
  return resolve(cover.image, cover.imageUrl, 'releases')
}
</script>

<template>
  <div
    v-if="coverImages.length > 0"
    class="grid h-full w-full"
    :class="{
      'grid-cols-1': coverImages.length === 1,
      'grid-cols-2': coverImages.length > 1,
    }"
  >
    <div
      v-for="(cover, idx) in coverImages.slice(0, 4)"
      :key="idx"
      class="relative overflow-hidden bg-zinc-900"
    >
      <img
        v-if="coverImageUrl(cover)"
        :src="coverImageUrl(cover)!"
        :alt="`Cover ${idx + 1}`"
        loading="lazy"
        class="h-full w-full object-cover transition-transform group-hover:scale-105"
      >
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-zinc-700"
      >
        <LucideMusic class="size-8" />
      </div>
    </div>
  </div>
  <div
    v-else
    class="flex h-full w-full items-center justify-center text-zinc-600"
  >
    <LucideListMusic class="size-12" />
  </div>
</template>
