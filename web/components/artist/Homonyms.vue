<script setup lang="ts">
import type { Artist } from '~/types/artist'
import { homonymNote } from '~/helpers/homonyms'

// Under an artist's name when others share it: what this one is ("Portuguese band · Portugal") and a "Did you mean
// <other> (<note>)?" line per other artist with the name, so the right page is one click away.
const props = defineProps<{
  artist: Artist
}>()

const others = computed(() => props.artist.homonyms ?? [])
const note = computed(() => homonymNote(props.artist))
</script>

<template>
  <div v-if="others.length" class="flex flex-col gap-2">
    <p class="text-base text-stone-100/60">
      {{ note ?? 'Not yet identified on MusicBrainz' }}
    </p>
    <p v-for="other in others" :key="other.id" class="text-sm text-stone-100/60">
      Did you mean
      <NuxtLink :to="`/artist/${other.slug}`" class="text-stone-100/80 underline decoration-stone-100/30 underline-offset-2 transition-colors hover:text-amber-400 hover:decoration-amber-400/60">
        {{ other.name }}{{ homonymNote(other) ? ` (${homonymNote(other)})` : '' }}</NuxtLink>?
    </p>
  </div>
</template>
