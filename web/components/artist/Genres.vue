<script setup lang="ts">
import type { Genre } from '~/types/artist'
import { maxGenres } from '~/helpers/constants'

const props = defineProps<{
  genres: Genre[]
}>()

const hasMoreGenres = computed(() => props.genres.length > maxGenres)
const visibleGenres = computed(() => props.genres.slice(0, maxGenres)) 

const emit = defineEmits<{
  'more': []
}>()
</script>

<template>
  <div v-if="genres.length" class="flex flex-wrap items-center gap-1.5">
    <NuxtLink
      v-for="genre in visibleGenres"
      :key="genre.id"
      :to="{ path: '/browse', query: { genre: genre.name } }"
      class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-amber-400"
    >
      {{ genre.name }}
    </NuxtLink>
    <button
      v-if="hasMoreGenres"
      class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-amber-500 hover:bg-zinc-700 transition-colors"
      @click="emit('more')"
    >
      +{{ genres.length - maxGenres }} more
    </button>
  </div>
</template>
