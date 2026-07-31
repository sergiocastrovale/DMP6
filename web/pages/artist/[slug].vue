<script setup lang="ts">
import { Loader2, RefreshCw, Search, HardDriveDownload, Globe, ListChecks, Radar } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ButtonDropdownOption } from '~/types/ui'
import type { Artist } from '~/types/artist'
import type { UnifiedRelease } from '~/types/release'
import type { Track } from '~/types/track'
import type { DownloadedReleaseStatus } from '~/types/download'
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

// --- Per-release download status (acquisition pipeline), polled while the page is open ---
type DlStatusItem = { mbReleaseId: string | null; status: string; downloadedReleaseId: string; percent: number; bytesTransferred: number; totalBytes: number }
type DlStatusValue = { status: string; downloadedReleaseId: string; percent: number; bytesTransferred: number; totalBytes: number }
const dlStatusMap = ref<Map<string, DlStatusValue>>(new Map())
let dlPoll: ReturnType<typeof setInterval> | null = null

const fetchDownloadStatus = async () => {
  try {
    const data = await $fetch<{ items: DlStatusItem[] }>(`/api/artists/${slug.value}/download-status`)
    const next = new Map<string, DlStatusValue>()
    for (const i of data.items) {
      if (i.mbReleaseId) {next.set(i.mbReleaseId, { status: i.status, downloadedReleaseId: i.downloadedReleaseId, percent: i.percent, bytesTransferred: i.bytesTransferred, totalBytes: i.totalBytes })}
    }
    // An item that was ready and is now gone was promoted (or rejected) ->
    // refresh the release list so the card flips to its final form.
    for (const [mbId, prev] of dlStatusMap.value) {
      if (prev.status === 'READY' && !next.has(mbId)) {
        refreshReleases()
        break
      }
    }
    dlStatusMap.value = next
  }
  catch { /* ignore */ }
}

onMounted(() => {
  fetchDownloadStatus()
  dlPoll = setInterval(fetchDownloadStatus, 2000)
})
onUnmounted(() => { if (dlPoll) {clearInterval(dlPoll)} })

const releases = computed(() => {
  const base = (releasesData.value?.releases ?? []) as UnifiedRelease[]
  if (dlStatusMap.value.size === 0) {return base}
  return base.map((r) => {
    const dl = r.mbReleaseRowId ? dlStatusMap.value.get(r.mbReleaseRowId) : undefined
    return dl ? { ...r, downloadState: dl.status, downloadedReleaseId: dl.downloadedReleaseId, downloadPercent: dl.percent } : r
  })
})

// In-flight acquisitions (download/enrich phase) for the header aggregate bar.
const dlInFlight = computed(() =>
  [...dlStatusMap.value.values()]
    .filter(d => d.status === 'DOWNLOADING' || d.status === 'ENRICHING')
    .map(d => ({ status: d.status as DownloadedReleaseStatus, percent: d.percent, bytesTransferred: d.bytesTransferred, totalBytes: d.totalBytes })),
)
const catalogue = useArtistCatalogue(releases)
provide('catalogue', catalogue)

// --- Monitor toggle (Lidarr-style auto-download of missing releases) ---
const monitorBusy = ref(false)
const toggleMonitor = async () => {
  if (!artist.value || monitorBusy.value) {return}
  monitorBusy.value = true
  const target = !artist.value.monitored
  artist.value.monitored = target // optimistic
  try {
    await $fetch<unknown, string>(`/api/artists/${slug.value}`, { method: 'PATCH', body: { monitored: target } })
    if (target) {fetchDownloadStatus()} // kick fired server-side; surface rows ASAP
  }
  catch {
    artist.value.monitored = !target // revert
  }
  finally {
    monitorBusy.value = false
  }
}

watch(() => terminal.isRunning, (running, wasRunning) => {
  if (wasRunning && !running) {
    refreshReleases()
  }
})

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
        :play-disabled="playingAll || !releases.length"
        :active-downloads="dlInFlight"
        class="min-w-0 flex-1"
        @play-all="playAll"
      >
        <div class="flex shrink-0 items-center gap-2">
          <UiButton
            :variant="artist.monitored ? 'primary' : 'secondary'"
            size="sm"
            :icon="Radar"
            :loading="monitorBusy"
            :title="artist.monitored
              ? 'Monitoring: missing releases are downloaded automatically. Click to stop.'
              : 'Start monitoring: auto-download missing releases into the approval queue.'"
            @click="toggleMonitor"
          >
            Monitor {{ artist.monitored ? 'ON' : 'OFF' }}
          </UiButton>
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
        :slug="artist.slug"
        :artist-name="artist.name"
        :releases="releases"
      />
    </div>
  </div>
</template>
