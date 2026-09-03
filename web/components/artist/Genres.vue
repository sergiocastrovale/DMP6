<script setup lang="ts">
import type { Genre } from '~/types/artist'

const props = defineProps<{
  genres: Genre[]
}>()

const maxGenresLg = 6

const visibleGenres = computed(() => props.genres.slice(0, maxGenresLg))

const breakpointClasses = ['', '', 'hidden md:inline-flex', 'hidden md:inline-flex', 'hidden lg:inline-flex', 'hidden lg:inline-flex']

const emit = defineEmits<{
  'more': []
}>()
</script>

<template>
  <div v-if="genres.length" class="flex flex-wrap items-center gap-1.5">
    <NuxtLink
      v-for="(genre, index) in visibleGenres"
      :key="genre.id"
      :to="{ path: '/browse', query: { genre: genre.name } }"
      :class="breakpointClasses[index]"
      class="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 hover:text-amber-400"
    >
      {{ genre.name }}
    </NuxtLink>
    <button
      v-if="genres.length > 2"
      type="button"
      class="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-amber-400 transition-colors duration-150 hover:bg-stone-700 md:hidden"
      @click="emit('more')"
    >
      +{{ genres.length - 2 }} more
    </button>
    <button
      v-if="genres.length > 4"
      type="button"
      class="hidden rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-amber-400 transition-colors duration-150 hover:bg-stone-700 md:inline-flex lg:hidden"
      @click="emit('more')"
    >
      +{{ genres.length - 4 }} more
    </button>
    <button
      v-if="genres.length > 6"
      type="button"
      class="hidden rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-amber-400 transition-colors duration-150 hover:bg-stone-700 lg:inline-flex"
      @click="emit('more')"
    >
      +{{ genres.length - 6 }} more
    </button>
  </div>
</template>
