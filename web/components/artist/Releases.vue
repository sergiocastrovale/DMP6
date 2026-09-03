<script setup lang="ts">
import type { UnifiedRelease, ReleaseGroup, ReleaseInfoExtra, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/types/ui'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { useToastStore } from '~/stores/toast'
import { scanSessionName } from '~/helpers/functions'
import { acquireFailureMessage, favoriteTargetId, findBundleParentRelease } from '~/helpers/artistPageLogic'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'

const props = defineProps<{
  slug: string
  artistName?: string
  releases: UnifiedRelease[]
}>()

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const { toggleOrPlay } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()
const toast = useToastStore()
const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!
// The artist page polls download status on demand only - acquiring or cancelling here is what
// creates/kills a row, so it has to kick the poll back into life.
const refreshDownloadStatus = inject<() => void>('refreshDownloadStatus', () => {})

const {
  showLinked, searchQuery, typeFilter, activeStatuses, sortKey,
  hasLinkedReleases, statusCounts, filteredReleases, groups,
} = catalogue

const initialView = route.query.view === 'list' ? 'list' : 'catalogue'
const viewMode = ref<'catalogue' | 'list'>(initialView)
const expandedGroup = ref<string | null>(null)
const expandedEdition = ref<string | null>(null)
const allTracks = ref<Track[]>([])
const allTracksLoading = ref(false)
const allTracksLoaded = ref(false)
const cancelRelease = ref<UnifiedRelease | null>(null)
const showCancelDialog = ref(false)
const redownloadRelease = ref<UnifiedRelease | null>(null)
const showRedownloadDialog = ref(false)
const infoRelease = ref<UnifiedRelease | null>(null)
const showInfoDialog = ref(false)
const infoExtra = ref<ReleaseInfoExtra | null>(null)
const favoriteReleases = ref<Set<string>>(new Set())
const acquiringIds = ref<Set<string>>(new Set())

onMounted(() => {
  downloadsStore.checkStatus()
  downloadsStore.fetchDownloadsEnabled()
})

onMounted(async () => {
  try {
    const data = await $fetch<any>('/api/favorites', { query: { type: 'releases', pageSize: 100 } })
    if (data?.releases) {
      favoriteReleases.value = new Set(data.releases.map((f: any) => f.release.id))
    }
  }
  catch { /* ignore */ }
})


const sortedGroups = computed<ReleaseGroup[]>(() => {
  const arr = [...groups.value]
  switch (sortKey.value) {
    case 'year-desc':
      arr.sort((a, b) => b.earliest.localeCompare(a.earliest))
      break
    case 'title':
      arr.sort((a, b) => a.primary.title.localeCompare(b.primary.title))
      break
    case 'tracks-desc':
      arr.sort((a, b) => b.totalTracks - a.totalTracks)
      break
    case 'plays-desc':
      arr.sort((a, b) => b.totalPlayCount - a.totalPlayCount)
      break
    default:
      arr.sort((a, b) => a.earliest.localeCompare(b.earliest))
  }
  return arr
})

const releaseMap = computed(() => {
  const map: Record<string, { title: string; status: ReleaseStatus; image: string | null; imageUrl: string | null }> = {}
  for (const r of props.releases) {
    if (r.localReleaseId) {
      map[r.localReleaseId] = { title: r.title, status: r.status, image: r.image, imageUrl: r.imageUrl }
    }
  }
  return map
})

const filteredAllTracks = computed(() => {
  let tracks = allTracks.value
  if (activeStatuses.value.size > 0) {
    const matchingReleaseIds = new Set(
      props.releases
        .filter(r => activeStatuses.value.has(r.status) && r.localReleaseId)
        .map(r => r.localReleaseId),
    )
    tracks = tracks.filter(t => t.localReleaseId && matchingReleaseIds.has(t.localReleaseId))
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    tracks = tracks.filter(t =>
      t.title?.toLowerCase().includes(q)
      || t.artist?.toLowerCase().includes(q)
      || t.album?.toLowerCase().includes(q),
    )
  }
  return tracks
})

const listViewColumns: TrackListColumn[] = [
  { key: 'play' },
  { key: 'release', label: 'Release' },
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'playCount', label: 'Plays' },
  { key: 'duration' },
  { key: 'favorite' },
]

watch(viewMode, (val) => {
  const query = { ...route.query }
  if (val === 'list') {
    query.view = 'list'
    loadAllTracks()
  } else {
    delete query.view
  }
  router.replace({ query })
}, { immediate: true })

function toReleaseSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// replacesLocalReleaseId is set only by the re-download flow: the server stamps it on the download
// row so the merge deletes this incomplete copy before moving the new one in.
const acquireRelease = async (release: UnifiedRelease, replacesLocalReleaseId?: string) => {
  if (!release.mbReleaseRowId || acquiringIds.value.has(release.id)) {
    return
  }
  acquiringIds.value = new Set(acquiringIds.value).add(release.id)
  try {
    const result = await $fetch<{ status: string }>('/api/downloads/acquire', {
      method: 'POST',
      body: { mbReleaseRowId: release.mbReleaseRowId, replacesLocalReleaseId },
    })
    const message = acquireFailureMessage(result.status)
    if (message) {
      toast.error(message)
    }
    refreshDownloadStatus()
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Download request failed')
  }
  finally {
    const next = new Set(acquiringIds.value)
    next.delete(release.id)
    acquiringIds.value = next
  }
}

const openRedownloadDialog = (release: UnifiedRelease) => {
  redownloadRelease.value = release
  showRedownloadDialog.value = true
}

const confirmRedownload = async () => {
  showRedownloadDialog.value = false
  const release = redownloadRelease.value
  redownloadRelease.value = null
  if (!release?.localReleaseId) {
    return
  }
  await acquireRelease(release, release.localReleaseId)
}

function openCancelDialog(release: UnifiedRelease) {
  cancelRelease.value = release
  showCancelDialog.value = true
}

async function confirmCancelDownload() {
  showCancelDialog.value = false
  const id = cancelRelease.value?.downloadedReleaseId
  cancelRelease.value = null
  if (!id) {
    return
  }
  await downloadsStore.cancel(id)
  refreshDownloadStatus()
}

function refreshRelease(edition: UnifiedRelease) {
  terminal.run('./refresh', ['--release', edition.localReleaseId!, '--overwrite'], scanSessionName('refresh-release', edition.localReleaseId!))
  terminal.open()
}

async function openInfoDialog(edition: UnifiedRelease) {
  infoRelease.value = edition
  infoExtra.value = null
  showInfoDialog.value = true
  if (edition.localReleaseId) {
    try {
      infoExtra.value = await $fetch<ReleaseInfoExtra>(`/api/releases/${edition.localReleaseId}/info`)
    }
    catch { /* ignore */ }
  }
}

function toggleGroup(key: string) {
  expandedGroup.value = expandedGroup.value === key ? null : key
  if (expandedGroup.value !== key) {
    expandedEdition.value = null
  }
}


function toggleEdition(id: string) {
  expandedEdition.value = expandedEdition.value === id ? null : id
}

const getReleaseId = (r: UnifiedRelease) => r.localReleaseId || r.id
const handleReleaseClick = (r: UnifiedRelease) => toggleOrPlay(getReleaseId(r), props.slug)

let allTracksSlug = ''
async function loadAllTracks() {
  if (allTracksLoaded.value && allTracksSlug === props.slug) {
    return
  }
  allTracksLoading.value = true
  try {
    allTracks.value = await $fetch<Track[]>(`/api/artists/${props.slug}/tracks`)
    allTracksSlug = props.slug
    allTracksLoaded.value = true
  }
  catch { /* ignore */ }
  finally {
    allTracksLoading.value = false
  }
}

function buildPlayerTracks(tracks: Track[], startTrack: Track) {
  const playerTracks = tracks.map(t => ({
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    artistSlug: props.slug,
    releaseImage: null as string | null,
    releaseImageUrl: null as string | null,
    localReleaseId: t.localReleaseId,
  }))
  const start = playerTracks.find(pt => pt.id === startTrack.id)
  player.setQueue(playerTracks, start)
}

async function toggleFavoriteRelease(release: UnifiedRelease) {
  const localId = favoriteTargetId(release)
  if (!localId) {
    return
  }
  const isFavorite = favoriteReleases.value.has(localId)
  try {
    await $fetch(`/api/favorites/releases/${localId}`, {
      method: isFavorite ? 'DELETE' : 'POST',
    })
    if (isFavorite) {
      favoriteReleases.value.delete(localId)
    } else {
      favoriteReleases.value.add(localId)
    }
  }
  catch { /* ignore */ }
}

const selectedTrackId = ref<string | null>(null)

async function expandAndScrollTo(release: UnifiedRelease) {
  const groupKey = release.releaseGroupId || `solo:${release.id}`
  expandedGroup.value = groupKey
  expandedEdition.value = release.id
  await nextTick()
  document.querySelector(`[data-group-key="${groupKey}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function handleReleaseDeepLink() {
  const targetSlug = route.query.release as string | undefined
  const targetId = route.query.releaseId as string | undefined
  if (!targetSlug && !targetId) {
    return
  }
  await nextTick()
  const release = targetId
    ? props.releases.find(r => r.localReleaseId === targetId || r.id === targetId)
    : props.releases.find(r => toReleaseSlug(r.title) === targetSlug)
  if (!release) {
    return
  }
  selectedTrackId.value = (route.query.trackId as string) || null
  await expandAndScrollTo(release)
}

async function goToBundleParent(release: UnifiedRelease) {
  const parent = findBundleParentRelease(props.releases, release)
  if (!parent) {
    return
  }
  await expandAndScrollTo(parent)
}

// onMounted (not an immediate watcher) for the initial run: handleReleaseDeepLink ends in
// document.querySelector, and an immediate watcher's callback runs synchronously at the
// watch() call site - during Nuxt's server-side setup(), where `document` doesn't exist. A
// deep-linked release (?releaseId=...) would reach that call once its `await nextTick()`
// resumed, throwing on the server. onMounted is client-only; the plain watch below only ever
// fires for a later, client-side change to `releases` (e.g. slower-arriving async data).
onMounted(() => {
  if (props.releases.length) {
    handleReleaseDeepLink()
  }
})

watch(() => props.releases, () => {
  if (props.releases.length) {
    handleReleaseDeepLink()
  }
})
</script>

<template>
  <div class="flex flex-col gap-4 p-3 md:px-6">
    <ArtistStatusChips v-model:active-statuses="activeStatuses" :status-counts="statusCounts" />

    <ArtistReleaseFilterBar v-model:view-mode="viewMode" />

    <template v-if="viewMode === 'catalogue'">
      <div>
        <ArtistReleaseGroupRow
          v-for="group in sortedGroups"
          :key="group.key"
          :group="group"
          :slug="slug"
          :expanded-group="expandedGroup"
          :expanded-edition="expandedEdition"
          :favorite-releases="favoriteReleases"
          :selected-track-id="selectedTrackId"
          :acquiring-ids="acquiringIds"
          @toggle-group="toggleGroup"
          @toggle-edition="toggleEdition"
          @play="handleReleaseClick"
          @download="acquireRelease"
          @redownload="openRedownloadDialog"
          @cancel="openCancelDialog"
          @toggle-favorite="toggleFavoriteRelease"
          @refresh="refreshRelease"
          @info="openInfoDialog"
          @go-to-bundle="goToBundleParent"
        />
      </div>

      <UiEmptyState v-if="sortedGroups.length === 0" message="No releases match your filters." hint="Try clearing a status, type or search filter." />
    </template>

    <template v-else>
      <div v-if="allTracksLoading" class="py-8 text-center text-base text-stone-100/55">
        Loading all tracks...
      </div>
      <UiEmptyState v-else-if="filteredAllTracks.length === 0" message="No tracks found." hint="Try clearing a status or search filter." />
      <ArtistTrackList
        v-else
        :tracks="filteredAllTracks"
        :columns="listViewColumns"
        :release-map="releaseMap"
        :build-player-tracks="buildPlayerTracks"
      />
    </template>

    <ReleaseInfoDialog
      v-model="showInfoDialog"
      :release="infoRelease"
      :extra="infoExtra"
      :is-favorite="infoRelease ? favoriteReleases.has(favoriteTargetId(infoRelease) ?? '') : false"
      :is-acquiring="infoRelease ? acquiringIds.has(infoRelease.id) : false"
      @toggle-favorite="infoRelease && toggleFavoriteRelease(infoRelease)"
      @refresh="infoRelease && refreshRelease(infoRelease)"
      @redownload="infoRelease && openRedownloadDialog(infoRelease)"
    />

    <ArtistRedownloadDialog
      v-model="showRedownloadDialog"
      :release="redownloadRelease"
      :artist-name="artistName"
      @confirm="confirmRedownload"
    />

    <DownloadsRejectDialog
      v-model="showCancelDialog"
      :title="cancelRelease?.title ?? null"
      heading="Cancel download"
      verb="Cancel the download of"
      confirm-label="Cancel & delete"
      @confirm="confirmCancelDownload"
    />
  </div>
</template>
