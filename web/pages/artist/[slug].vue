<script setup lang="ts">
import { Loader2, RefreshCw, Search, HardDriveDownload, Globe, ListChecks } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ButtonDropdownOption } from '~/types/ui'
import type { Artist } from '~/types/artist'
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import { useTerminalStore } from '~/stores/terminal'
import { scanActions } from '~/helpers/constants'

const scanIcons: Record<string, Component> = { Search, RefreshCw, HardDriveDownload, Globe, ListChecks }

definePageMeta({
  layout: 'default',
  layoutClasses: 'p-0',
})

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const terminal = useTerminalStore()
const player = usePlayerStore()

const { data: artist, pending: artistPending, error } = useFetch<Artist>(() => `/api/artists/${slug.value}`, {
  key: `artist-${slug.value}`,
})

const { data: releasesData, pending: releasesPending, refresh: refreshReleases } = useFetch(() => `/api/artists/${slug.value}/releases`, {
  key: `artist-releases-${slug.value}`,
  query: { pageSize: 500 },
})

const releases = computed(() => (releasesData.value?.releases ?? []) as UnifiedRelease[])

watch(() => terminal.isRunning, (running, wasRunning) => {
  if (wasRunning && !running) {
    refreshReleases()
  }
})
const showMissing = ref(true)
const pending = computed(() => artistPending.value || releasesPending.value)

const artistFolders = computed(() => {
  const paths = releases.value
    .filter(r => r.hasLocal && r.folderPath)
    .map(r => r.folderPath!)
  return [...new Set(paths)]
})

const artistActions: Record<string, (name: string, folders: string[]) => () => Promise<void>> = {
  'check': (name, folders) => async () => {
    if (folders.length) {
      await terminal.run('./index', ['--folders', folders.join(';')])
    }
    await terminal.run('./sync', ['--only', name, '--exact'])
  },
  'index-sync': (name, folders) => async () => {
    if (folders.length) {
      await terminal.run('./index', ['--folders', folders.join(';'), '--overwrite'])
    }
    await terminal.run('./sync', ['--only', name, '--exact', '--overwrite'])
  },
  'index': (_name, folders) => async () => {
    if (folders.length) {
      await terminal.run('./index', ['--folders', folders.join(';'), '--overwrite'])
    }
  },
  'sync': (name) => async () => {
    await terminal.run('./sync', ['--only', name, '--exact', '--overwrite'])
  },
  'catalogue-gaps': (name) => async () => {
    await terminal.run('./sync', ['--only', name, '--exact', '--catalogue-gaps'])
  },
}

const syncOptions = computed<ButtonDropdownOption[]>(() => {
  const name = artist.value?.name ?? ''
  const folders = artistFolders.value
  return scanActions.map(s => ({
    label: s.text,
    description: s.subtext,
    icon: scanIcons[s.icon],
    action: artistActions[s.id]!(name, folders),
  }))
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
      <Loader2 :size="24" class="animate-spin text-ink0" />
    </div>
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-ink">Artist not found</p>
      <p class="mt-1 text-sm text-ink-2">The artist you're looking for doesn't exist.</p>
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
            label="Scan catalogue"
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
