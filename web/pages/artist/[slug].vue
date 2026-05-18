<script setup lang="ts">
import { Loader2, RefreshCw } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/components/ButtonDropdown.vue'
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import { useTerminalStore } from '~/stores/terminal'

definePageMeta({
  layout: 'default',
  layoutClasses: 'p-0',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const terminal = useTerminalStore()
const player = usePlayerStore()

const { data: artist, pending: artistPending, error } = useFetch(() => `/api/artists/${slug.value}`, {
  key: `artist-${slug.value}`,
})

const { data: releasesData, pending: releasesPending, refresh: refreshReleases } = useFetch(() => `/api/artists/${slug.value}/releases`, {
  key: `artist-releases-${slug.value}`,
  query: { pageSize: 500 },
})

const releases = computed<UnifiedRelease[]>(() => releasesData.value?.releases ?? [])

watch(() => terminal.isRunning, (running, wasRunning) => {
  if (wasRunning && !running) {
    refreshReleases()
  }
})
const showMissing = ref(true)
const pending = computed(() => artistPending.value || releasesPending.value)

const syncOptions = computed<ButtonDropdownOption[]>(() => {
  const name = artist.value?.name ?? ''
  return [
    {
      label: 'Update',
      description: 'Sync new & changed files',
      action: () => terminal.run('./refresh', ['--only', name]),
    },
    {
      label: 'Re-sync',
      description: 'Nuke & rebuild from scratch',
      action: () => terminal.run('./refresh', ['--only', name, '--overwrite']),
    },
  ]
})

const playingAll = ref(false)
const playAll = async () => {
  if (playingAll.value) {
    return
  }
  playingAll.value = true
  try {
    const tracks = await $fetch<Track[]>(`/api/artists/${slug.value}/tracks`)
    const playable = tracks.filter(t => !t.missing)
    if (!playable.length) {
      return
    }
    const playerTracks = playable.map(t => ({
      id: t.id,
      title: t.title || 'Unknown',
      artist: t.artist || 'Unknown',
      album: t.album || 'Unknown',
      duration: t.duration || 0,
      artistSlug: slug.value,
      releaseImage: null as string | null,
      releaseImageUrl: null as string | null,
      localReleaseId: t.localReleaseId,
    }))
    player.setQueue(playerTracks, playerTracks[0])
  }
  catch { /* ignore */ }
  finally {
    playingAll.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="pending" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-zinc-50">Artist not found</p>
      <p class="mt-1 text-sm text-zinc-400">The artist you're looking for doesn't exist.</p>
    </div>
    <div v-else-if="artist" class="flex flex-col gap-8">
      <ArtistHeader
        :artist="artist"
        :releases="releases"
        :play-disabled="playingAll || !releases.length"
        class="min-w-0 flex-1"
        @play-all="playAll"
      >
        <div class="flex shrink-0 items-center gap-2">
          <ButtonDropdown
            label="Sync"
            :options="syncOptions"
            :disabled="terminal.isRunning"
          >
            <template #icon>
              <Loader2 v-if="terminal.isRunning" :size="14" class="animate-spin" />
              <RefreshCw v-else :size="14" />
            </template>
          </ButtonDropdown>
        </div>
      </ArtistHeader>
      
      <ArtistReleases
        v-model:show-missing="showMissing"
        :slug="artist.slug"
        :artist-name="artist.name"
        :releases="releases"
      />
    </div>
  </div>
</template>
