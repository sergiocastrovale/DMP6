<script setup lang="ts">
import { LucideMusic, LucideListMusic } from 'lucide-vue-next'

const props = defineProps<{
  images: Array<{ image: string | null; imageUrl: string | null }>
}>()

const { resolve } = useImageUrl()

const covers = computed(() => props.images.slice(0, 4))

const hasCovers = computed(() => covers.value.length > 0)

const coverImageUrl = (cover: { image: string | null; imageUrl: string | null }) => {
  return resolve(cover.image, cover.imageUrl, 'releases')
}
</script>

<template>
  <div
    v-if="hasCovers"
    class="grid h-full w-full"
    :class="{
      'grid-cols-1': covers.length === 1,
      'grid-cols-2': covers.length > 1,
    }"
  >
    <div
      v-for="(cover, idx) in covers"
      :key="idx"
      class="relative overflow-hidden bg-stone-900"
    >
      <img
        v-if="coverImageUrl(cover)"
        :src="coverImageUrl(cover)!"
        alt=""
        loading="lazy"
        class="h-full w-full object-cover transition-transform duration-400 group-hover:scale-105"
      >
      <div
        v-else
        class="flex h-full w-full items-center justify-center text-stone-100/20"
      >
        <LucideMusic class="size-8" />
      </div>
    </div>
  </div>
  <div
    v-else
    class="flex h-full w-full items-center justify-center text-stone-100/20"
  >
    <LucideListMusic class="size-12" />
  </div>
</template>
