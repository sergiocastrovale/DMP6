<script setup lang="ts">
import type { UnifiedRelease, ReleaseGroup, ReleaseInfoExtra, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/types/ui'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'

const props = defineProps<{
  slug: string
  artistName?: string
  releases: UnifiedRelease[]
}>()

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const { isCurrentRelease: isCurrentReleaseId, toggleOrPlay } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()
const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!

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
const infoRelease = ref<UnifiedRelease | null>(null)
const showInfoDialog = ref(false)
const infoExtra = ref<ReleaseInfoExtra | null>(null)
const favoriteReleases = ref<Set<string>>(new Set())

onMounted(() => {
  downloadsStore.checkStatus()
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
  if (activeStatuses.value.size < statuses.length) {
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

const acquireRelease = async (release: UnifiedRelease) => {
  if (!release.mbReleaseRowId) {
    return
  }
  try {
    await $fetch('/api/downloads/acquire', { method: 'POST', body: { mbReleaseRowId: release.mbReleaseRowId } })
  }
  catch { /* ignore */ }
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
}

function refreshRelease(edition: UnifiedRelease) {
  terminal.run('./refresh', ['--release', edition.localReleaseId!, '--overwrite'])
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

function handleGroupPlayClick(group: ReleaseGroup) {
  const current = group.releases.find(r => isCurrentReleaseId(getReleaseId(r)))
  const target = current
    || group.releases.find(r => r.localReleaseId || r.localTrackCount > 0)
    || group.primary
  toggleOrPlay(getReleaseId(target), props.slug)
}

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
  if (!release.localReleaseId) {
    return
  }
  const localId = release.localReleaseId!
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
  await nextTick()
  const groupKey = release.releaseGroupId || `solo:${release.id}`
  expandedGroup.value = groupKey
  expandedEdition.value = release.id
  selectedTrackId.value = (route.query.trackId as string) || null
  await nextTick()
  document.querySelector(`[data-group-key="${groupKey}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(() => props.releases, () => {
  if (props.releases.length) {
    handleReleaseDeepLink()
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-4 px-8">
    <ArtistStatusChips v-model:active-statuses="activeStatuses" :status-counts="statusCounts" />

    <ArtistReleaseFilterBar v-model:view-mode="viewMode" />

    <template v-if="viewMode === 'catalogue'">
      <Table>
        <ArtistReleaseGroupRow
          v-for="group in sortedGroups"
          :key="group.key"
          :group="group"
          :expanded="expandedGroup === group.key"
          :slug="slug"
          :single-edition="group.releases.length === 1"
          @toggle="toggleGroup(group.key)"
          @play="handleGroupPlayClick(group)"
          @download="acquireRelease(group.primary)"
          @cancel="openCancelDialog(group.primary)"
          @refresh="refreshRelease(group.primary)"
          @info="openInfoDialog(group.primary)"
        >
          <template v-if="group.releases.length === 1">
            <div v-if="group.primary.localReleaseId || group.primary.localTrackCount > 0" class="border-t border-rule px-3 pb-3">
              <ReleaseTracksTable
                :release-id="group.primary.localReleaseId || group.primary.mbReleaseRowId || group.primary.id"
                :selected-track-id="selectedTrackId"
              />
            </div>
          </template>
          <template v-else>
            <ArtistReleaseEditionRow
              v-for="edition in group.releases"
              :key="edition.id"
              :edition="edition"
              :expanded="expandedEdition === edition.id"
              :is-favorite="!!edition.localReleaseId && favoriteReleases.has(edition.localReleaseId)"
              :slug="slug"
              :selected-track-id="expandedEdition === edition.id ? selectedTrackId : null"
              @toggle="toggleEdition(edition.id)"
              @play="handleReleaseClick(edition)"
              @download="acquireRelease(edition)"
              @cancel="openCancelDialog(edition)"
              @toggle-favorite="toggleFavoriteRelease(edition)"
              @refresh="refreshRelease(edition)"
              @info="openInfoDialog(edition)"
            />
          </template>
        </ArtistReleaseGroupRow>
      </Table>

      <div v-if="sortedGroups.length === 0" class="py-8 text-center text-sm text-ink0">
        No releases match your filters
      </div>
    </template>

    <template v-else>
      <div v-if="allTracksLoading" class="py-8 text-center text-sm text-ink0">
        Loading all tracks...
      </div>
      <div v-else-if="filteredAllTracks.length === 0" class="py-8 text-center text-sm text-ink0">
        No tracks found
      </div>
      <TrackList
        v-else
        :tracks="filteredAllTracks"
        :columns="listViewColumns"
        :release-map="releaseMap"
        :build-player-tracks="buildPlayerTracks"
      />
    </template>

    <ArtistReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />

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
