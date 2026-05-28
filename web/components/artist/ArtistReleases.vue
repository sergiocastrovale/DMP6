<script setup lang="ts">
import type { UnifiedRelease, ReleaseGroup, ReleaseInfoExtra, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn, ButtonDropdownOption } from '~/types/ui'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'

const props = defineProps<{
  slug: string
  artistName?: string
  releases: UnifiedRelease[]
}>()

const showMissing = defineModel<boolean>('showMissing', { default: true })

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const { isCurrentRelease: isCurrentReleaseId, toggleOrPlay } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()

const searchQuery = ref('')
const typeFilter = ref<string | null>(null)
const activeStatuses = ref<Set<string>>(new Set(statuses.map(s => s.value)))
const sortKey = ref<string>('year-asc')
const initialView = route.query.view === 'list' ? 'list' : 'catalogue'
const viewMode = ref<'catalogue' | 'list'>(initialView)
const expandedGroup = ref<string | null>(null)
const expandedEdition = ref<string | null>(null)
const allTracks = ref<Track[]>([])
const allTracksLoading = ref(false)
const allTracksLoaded = ref(false)
const downloadRelease = ref<UnifiedRelease | null>(null)
const showDownloadDialog = ref(false)
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

const visibleReleases = computed(() =>
  showMissing.value
    ? props.releases
    : props.releases.filter(r => r.status !== 'MISSING'),
)

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const r of visibleReleases.value) {
    counts[r.status] = (counts[r.status] || 0) + 1
  }
  return counts
})

const filteredReleases = computed(() => {
  let r = visibleReleases.value

  if (activeStatuses.value.size < statuses.length) {
    r = r.filter(x => activeStatuses.value.has(x.status))
  }

  if (typeFilter.value) {
    if (typeFilter.value === 'other') {
      r = r.filter(x => !['album', 'ep', 'single'].includes(x.typeSlug))
    } else {
      r = r.filter(x => x.typeSlug === typeFilter.value)
    }
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    r = r.filter(x =>
      x.title.toLowerCase().includes(q)
      || (x.disambiguation || '').toLowerCase().includes(q)
      || (x.editionLabel || '').toLowerCase().includes(q),
    )
  }
  return r
})

const dateKey = (r: UnifiedRelease) => r.releaseDate || (r.year ? `${r.year}-00-00` : '9999-99-99')

const groups = computed<ReleaseGroup[]>(() => {
  const buckets = new Map<string, UnifiedRelease[]>()
  for (const r of filteredReleases.value) {
    const key = r.releaseGroupId || `solo:${r.id}`
    const arr = buckets.get(key)
    if (arr) {
      arr.push(r)
    } else {
      buckets.set(key, [r])
    }
  }
  const out: ReleaseGroup[] = []
  for (const [key, items] of buckets.entries()) {
    items.sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
    const primary = items[0]!
    const totalTracks = items.reduce((s, r) => s + (r.trackCount || 0), 0)
    const totalLocalTracks = items.reduce((s, r) => s + (r.localTrackCount || 0), 0)
    const totalPlayCount = items.reduce((s, r) => s + (r.totalPlayCount || 0), 0)
    out.push({ key, releases: items, primary, totalTracks, totalLocalTracks, totalPlayCount, earliest: dateKey(primary) })
  }
  return out
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

const missingReleasesVisible = computed(() => filteredReleases.value.filter(r => r.status === 'MISSING'))

const downloadAllOptions = computed<ButtonDropdownOption[]>(() => {
  const missing = missingReleasesVisible.value
  if (missing.length === 0) {
    return []
  }
  const artist = props.artistName || ''
  const opts: ButtonDropdownOption[] = []
  if (downloadsStore.slskd.connected) {
    opts.push({
      label: `Soulseek (${missing.length})`,
      description: `Search & download ${missing.length} missing releases`,
      action: () => {
        const first = missing[0]
        if (first) {
          terminal.runDownload('slskd', `${artist} ${first.title}`, first.title, artist, first.year)
        }
      },
    })
  }
  if (downloadsStore.hifi.connected) {
    opts.push({
      label: `HiFi (${missing.length})`,
      description: 'Free FLAC lossless — no account needed',
      action: () => {
        const first = missing[0]
        if (first) {
          terminal.runDownload('hifi', `${artist} ${first.title}`, first.title, artist, first.year)
        }
      },
    })
  }
  if (downloadsStore.deezer.connected) {
    opts.push({
      label: `Deezer (${missing.length})`,
      description: `Download ${missing.length} missing releases from Deezer`,
      action: () => {
        const first = missing[0]
        if (first) {
          terminal.runDownload('deezer', `${artist} ${first.title}`, first.title, artist, first.year)
        }
      },
    })
  }
  return opts
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

function openDownloadDialog(release: UnifiedRelease) {
  downloadRelease.value = release
  showDownloadDialog.value = true
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
  } else {
    const group = groups.value.find(g => g.key === key)
    if (group?.releases.length === 1 && (group.releases[0]!.localReleaseId || group.releases[0]!.localTrackCount > 0)) {
      expandedEdition.value = group.releases[0]!.id
    }
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

    <ArtistReleaseFilterBar
      v-model:search-query="searchQuery"
      v-model:type-filter="typeFilter"
      v-model:show-missing="showMissing"
      v-model:sort-key="sortKey"
      v-model:view-mode="viewMode"
      :download-options="downloadAllOptions"
      :show-download="downloadsStore.anyConfigured && missingReleasesVisible.length > 0 && showMissing"
    />

    <template v-if="viewMode === 'catalogue'">
      <Table>
        <ArtistReleaseGroupRow
          v-for="group in sortedGroups"
          :key="group.key"
          :group="group"
          :expanded="expandedGroup === group.key"
          :slug="slug"
          @toggle="toggleGroup(group.key)"
          @play="handleGroupPlayClick(group)"
        >
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
            @download="openDownloadDialog(edition)"
            @toggle-favorite="toggleFavoriteRelease(edition)"
            @refresh="refreshRelease(edition)"
            @info="openInfoDialog(edition)"
          />
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

    <ReleaseDownloadDialog
      v-if="showDownloadDialog && downloadRelease"
      v-model="showDownloadDialog"
      :release-title="downloadRelease.title"
      :artist-name="props.artistName || ''"
      :release-year="downloadRelease.year"
    />

    <ArtistReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />
  </div>
</template>
