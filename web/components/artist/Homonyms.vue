<script setup lang="ts">
import type { Artist } from '~/types/artist'
import { homonymNote } from '~/helpers/homonyms'

// Under an artist's name when others share it: what this one is ("Portuguese band · Portugal") and a chip per other
// artist with the name, so the right page is one click away.
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
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-stone-100/55">Also named {{ artist.name }}:</span>
      <NuxtLink
        v-for="other in others"
        :key="other.id"
        :to="`/artist/${other.slug}`"
        class="rounded-full border border-stone-100/15 px-3 py-1 text-stone-100/80 transition-colors hover:border-amber-400/60 hover:text-stone-100"
      >
        {{ homonymNote(other) ?? 'unidentified' }} · {{ other.releaseCount }} {{ other.releaseCount === 1 ? 'release' : 'releases' }}
      </NuxtLink>
    </div>
  </div>
</template>
