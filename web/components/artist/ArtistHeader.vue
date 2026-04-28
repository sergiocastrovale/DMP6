<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import type { UnifiedRelease } from '~/types/release'
import DialogLinks from '~/components/artist/DialogLinks.vue'
import DialogGenres from '~/components/artist/DialogGenres.vue'
import Genres from '~/components/artist/Genres.vue'

const props = defineProps<{
  artist: Artist
  releases: UnifiedRelease[]
  playDisabled?: boolean
}>()

const emit = defineEmits<{
  playAll: []
}>()

const showAllGenres = ref(false)
const showAllLinks = ref(false)

const groupCounts = computed(() => {
  const seen = new Map<string, string>()
  for (const r of props.releases) {
    const key = r.releaseGroupId || `solo:${r.id}`
    if (!seen.has(key)) {
      seen.set(key, r.typeSlug)
    }
  }
  const counts = { albums: 0, eps: 0, singles: 0 }
  for (const t of seen.values()) {
    if (t === 'album') {
      counts.albums++
    }
    else if (t === 'ep') {
      counts.eps++
    }
    else if (t === 'single') {
      counts.singles++
    }
  }
  return counts
})

const statsParts = computed(() => {
  const parts: string[] = []
  if (props.artist.totalTracks) {
    parts.push(`${props.artist.totalTracks.toLocaleString()} tracks`)
  }
  const c = groupCounts.value
  if (c.albums) {
    parts.push(`${c.albums} ${c.albums === 1 ? 'album' : 'albums'}`)
  }
  if (c.eps) {
    parts.push(`${c.eps} ${c.eps === 1 ? 'EP' : 'EPs'}`)
  }
  if (c.singles) {
    parts.push(`${c.singles} ${c.singles === 1 ? 'single' : 'singles'}`)
  }
  return parts
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-3">
      <h1 class="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
        {{ artist.name }}
      </h1>

      <div v-if="statsParts.length" class="text-sm text-zinc-400">
        {{ statsParts.join(' · ') }}
      </div>

      <Genres :genres="artist.genres" @more="showAllGenres = true" />

      <div>
        <button
          type="button"
          :disabled="playDisabled"
          class="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          @click="emit('playAll')"
        >
          <Play :size="14" fill="currentColor" />
          <span>Play all</span>
        </button>
      </div>
    </div>

    <DialogGenres v-model="showAllGenres" :genres="artist.genres" />
    <DialogLinks v-model="showAllLinks" :links="artist.urls" />
  </div>
</template>
