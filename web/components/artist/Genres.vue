<script setup lang="ts">
import type { Genre } from '~/types/artist'

const props = defineProps<{
  genres: Genre[]
}>()

const maxGenres = 4

const visibleGenres = computed(() => props.genres.slice(0, maxGenres))
const hiddenCount = computed(() => props.genres.length - maxGenres)

const emit = defineEmits<{
  'seeAll': []
}>()
</script>

<template>
  <div v-if="genres.length" class="flex flex-wrap items-center gap-1.5">
    <NuxtLink
      v-for="genre in visibleGenres"
      :key="genre.id"
      :to="{ path: '/browse', query: { genre: genre.name } }"
      class="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 hover:text-amber-400"
    >
      {{ genre.name }}
    </NuxtLink>
    <button
      v-if="hiddenCount > 0"
      type="button"
      class="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-amber-400 transition-colors duration-150 hover:bg-stone-700"
      @click="emit('seeAll')"
    >
      +{{ hiddenCount }} more
    </button>
  </div>
</template>
