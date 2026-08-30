<script setup lang="ts">
import type { Genre } from '~/types/artist'

const props = defineProps<{
  genres: Genre[]
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <Dialog :model-value="modelValue" title="All Genres" @update:model-value="emit('update:modelValue', $event)">
    <div class="flex flex-wrap gap-2">
      <NuxtLink
        v-for="genre in props.genres"
        :key="genre.id"
        :to="{ path: '/browse', query: { genre: genre.name } }"
        class="rounded-full bg-stone-800 px-3 py-1 text-sm text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 hover:text-amber-400"
      >
        {{ genre.name }}
      </NuxtLink>
    </div>
  </Dialog>
</template>
