<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3, Download, FolderClosed, Heart, LayoutGrid, LayoutList, Link, ListFilter, Pause, Play } from 'lucide-vue-next'
import type { UnifiedRelease, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/components/TrackList.vue'
import type { ButtonDropdownOption } from '~/components/ButtonDropdown.vue'
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
const player = usePlayerStore()
const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId, toggleOrPlay } = usePlayRelease()
const { releaseImage } = useImageUrl()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()

const TAB_BUCKETS = [
  { slug: 'albums', label: 'Albums', match: (t: string) => t === 'album' },
  { slug: 'eps', label: 'EPs', match: (t: string) => t === 'ep' },
  { slug: 'singles', label: 'Singles', match: (t: string) => t === 'single' },
  { slug: 'unmatched', label: 'Unmatched', match: (t: string) => t === 'unmatched' || t === 'appears-on' },
  { slug: 'other', label: 'Other', match: (_t: string) => true },
] as const

const SORT_OPTIONS = [
  { value: 'year-asc', label: 'Year (oldest first)' },
  { value: 'year-desc', label: 'Year (newest first)' },
  { value: 'title', label: 'Title' },
  { value: 'tracks-desc', label: 'Most tracks' },
  { value: 'plays-desc', label: 'Most played' },
] as const

const searchQuery = ref('')
const statusFilter = ref<string | null>(null)
const sortKey = ref<string>('year-asc')
const viewMode = ref<'catalogue' | 'list'>('catalogue')
const activeTab = ref<string>('albums')
const expandedGroup = ref<string | null>(null)
const expandedEdition = ref<string | null>(null)
const sortOpen = ref(false)
const allTracks = ref<Track[]>([])
const allTracksLoading = ref(false)
const allTracksLoaded = ref(false)
const downloadRelease = ref<UnifiedRelease | null>(null)
const showDownloadDialog = ref(false)
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

function bucketSlug(typeSlug: string) {
  for (const b of TAB_BUCKETS) {
    if (b.match(typeSlug)) {
      return b.slug
    }
  }
  return 'other'
}

function toReleaseSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const visibleReleases = computed(() => {
  return showMissing.value
    ? props.releases
    : props.releases.filter(r => r.status !== 'MISSING')
})

const tabCounts = computed(() => {
  const counts: Record<string, number> = { albums: 0, eps: 0, singles: 0, other: 0, unmatched: 0 }
  for (const r of visibleReleases.value) {
    counts[bucketSlug(r.typeSlug)]++
  }
  return counts
})

const visibleTabs = computed(() => TAB_BUCKETS.filter(t => tabCounts.value[t.slug] > 0))

const tabItems = computed(() => visibleTabs.value.map(t => ({
  key: t.slug,
  label: t.label,
  count: tabCounts.value[t.slug],
})))

watch(visibleTabs, (tabs) => {
  if (tabs.length && !tabs.find(t => t.slug === activeTab.value)) {
    activeTab.value = tabs[0]!.slug
  }
}, { immediate: true })

const tabFiltered = computed(() => {
  let r = visibleReleases.value.filter(x => bucketSlug(x.typeSlug) === activeTab.value)
  if (statusFilter.value) {
    r = r.filter(x => x.status === statusFilter.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    r = r.filter(x => x.title.toLowerCase().includes(q) || (x.disambiguation || '').toLowerCase().includes(q) || (x.editionLabel || '').toLowerCase().includes(q))
  }
  return r
})

type ReleaseGroup = {
  key: string
  releases: UnifiedRelease[]
  primary: UnifiedRelease
  totalTracks: number
  totalLocalTracks: number
  totalPlayCount: number
  earliest: string
}

const dateKey = (r: UnifiedRelease) => r.releaseDate || (r.year ? `${r.year}-00-00` : '9999-99-99')

const groups = computed<ReleaseGroup[]>(() => {
  const buckets = new Map<string, UnifiedRelease[]>()
  for (const r of tabFiltered.value) {
    const key = r.releaseGroupId || `solo:${r.id}`
    const arr = buckets.get(key)
    if (arr) {
      arr.push(r)
    }
    else {
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

const missingReleasesInTab = computed(() => tabFiltered.value.filter(r => r.status === 'MISSING'))

const downloadAllOptions = computed<ButtonDropdownOption[]>(() => {
  const missing = missingReleasesInTab.value
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
  if (statusFilter.value) {
    const matchingReleaseIds = new Set(
      props.releases
        .filter(r => r.status === statusFilter.value && r.localReleaseId)
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
  { key: 'release', label: 'Release' },
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'playCount', label: 'Plays' },
  { key: 'favorite' },
  { key: 'duration' },
]

const releaseTrackColumns: TrackListColumn[] = [
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'playCount', label: 'Plays' },
  { key: 'duration' },
  { key: 'favorite' },
]

function statusDescription(status: string) {
  return statuses.find(s => s.value === status)?.description ?? ''
}

function editionLabel(r: UnifiedRelease) {
  return r.disambiguation || r.editionLabel || null
}

function editionDisplayTitle(r: UnifiedRelease) {
  return editionLabel(r) || 'Original release'
}

function openDownloadDialog(release: UnifiedRelease) {
  downloadRelease.value = release
  showDownloadDialog.value = true
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
const isCurrentRelease = (r: UnifiedRelease) => isCurrentReleaseId(getReleaseId(r))
const isReleasePlaying = (r: UnifiedRelease) => isReleasePlayingId(getReleaseId(r))
const handleReleaseClick = (r: UnifiedRelease) => toggleOrPlay(getReleaseId(r), props.slug)

function handleGroupPlayClick(group: ReleaseGroup) {
  const current = group.releases.find(r => isCurrentRelease(r))
  const target = current
    || group.releases.find(r => r.localReleaseId || r.localTrackCount > 0)
    || group.primary
  toggleOrPlay(getReleaseId(target), props.slug)
}

function isGroupCurrent(group: ReleaseGroup) {
  return group.releases.some(r => isCurrentRelease(r))
}

function isGroupPlaying(group: ReleaseGroup) {
  return group.releases.some(r => isReleasePlaying(r))
}

function groupHasPlayable(group: ReleaseGroup) {
  return group.releases.some(r => r.localReleaseId || r.localTrackCount > 0)
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

function switchToListView() {
  viewMode.value = 'list'
  loadAllTracks()
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
  if (!release.mbReleaseRowId) {
    return
  }
  const mbRowId = release.mbReleaseRowId
  const isFavorite = favoriteReleases.value.has(release.id)
  try {
    await $fetch(`/api/favorites/releases/${mbRowId}`, {
      method: isFavorite ? 'DELETE' : 'POST',
    })
    if (isFavorite) {
      favoriteReleases.value.delete(release.id)
    }
    else {
      favoriteReleases.value.add(release.id)
    }
  }
  catch { /* ignore */ }
}

async function handleReleaseDeepLink() {
  const targetSlug = route.query.release as string | undefined
  if (!targetSlug) {
    return
  }
  await nextTick()
  const release = props.releases.find(r => toReleaseSlug(r.title) === targetSlug)
  if (!release) {
    return
  }
  activeTab.value = bucketSlug(release.typeSlug)
  await nextTick()
  const groupKey = release.releaseGroupId || `solo:${release.id}`
  expandedGroup.value = groupKey
  expandedEdition.value = release.id
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
    <Tabs v-if="visibleTabs.length > 0" v-model="activeTab" :tabs="tabItems">
      <template #append>
        <div class="pb-2">
          <Switch v-model="showMissing" label="Show missing" />
        </div>
      </template>
    </Tabs>

    <div class="flex flex-wrap items-center gap-3">
      <ArtistReleaseSearch v-model="searchQuery" placeholder="Search releases..." />

      <Dropdown
        v-model="statusFilter"
        :options="statuses"
        placeholder="Status"
      />

      <ButtonDropdown
        v-if="downloadsStore.anyConfigured && missingReleasesInTab.length > 0 && showMissing"
        label="Download missing"
        :options="downloadAllOptions"
      >
        <template #icon>
          <Download :size="14" />
        </template>
      </ButtonDropdown>

      <div class="flex-1" />

      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-50"
          @click="sortOpen = !sortOpen"
        >
          <ListFilter :size="12" />
          <span>Sort</span>
        </button>
        <div
          v-if="sortOpen"
          class="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
        >
          <button
            v-for="opt in SORT_OPTIONS"
            :key="opt.value"
            type="button"
            class="flex w-full items-center rounded px-3 py-2 text-left text-xs transition-colors"
            :class="sortKey === opt.value ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50'"
            @click="sortKey = opt.value; sortOpen = false"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="sortOpen" class="fixed inset-0 z-10" @click="sortOpen = false" />
      </div>

      <div class="flex items-center rounded-lg border border-zinc-700 bg-zinc-900">
        <button
          type="button"
          class="rounded-l-lg px-2.5 py-1.5 transition-colors"
          :class="viewMode === 'list' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50'"
          title="List view"
          @click="switchToListView()"
        >
          <LayoutList :size="16" />
        </button>
        <button
          type="button"
          class="rounded-r-lg px-2.5 py-1.5 transition-colors"
          :class="viewMode === 'catalogue' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50'"
          title="Catalogue view"
          @click="viewMode = 'catalogue'"
        >
          <LayoutGrid :size="16" />
        </button>
      </div>
    </div>

    <template v-if="viewMode === 'catalogue'">
      <Table>
        <div
          v-for="group in sortedGroups"
          :key="group.key"
          :data-group-key="group.key"
          class="border-b border-zinc-800 last:border-b-0 transition-colors"
          :class="group.primary.status === 'MISSING' ? '' : 'hover:bg-zinc-800/50'"
        >
          <div class="group flex cursor-pointer items-center gap-3 p-3" @click="toggleGroup(group.key)">
            <button
              type="button"
              class="flex size-5 items-center justify-center text-zinc-500"
              @click.stop="toggleGroup(group.key)"
            >
              <ChevronDown v-if="expandedGroup === group.key" :size="14" />
              <ChevronRight v-else :size="14" />
            </button>

            <div
              class="group/cover relative size-10 shrink-0 cursor-pointer overflow-hidden rounded bg-zinc-800"
              @click.stop="groupHasPlayable(group) && handleGroupPlayClick(group)"
            >
              <img
                v-if="releaseImage(group.primary)"
                :src="releaseImage(group.primary)!"
                :alt="group.primary.title"
                class="size-full object-cover"
                loading="lazy"
              />
              <div v-else class="flex size-full items-center justify-center text-zinc-600">
                <Disc3 :size="20" />
              </div>
              <div
                v-if="groupHasPlayable(group)"
                class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover/cover:bg-black/60"
              >
                <Pause v-if="isGroupPlaying(group)" :size="14" fill="currentColor" class="text-amber-400" />
                <Play
                  v-else
                  :size="14"
                  fill="currentColor"
                  :class="isGroupCurrent(group) ? 'text-amber-400' : 'text-white/50 group-hover/cover:text-white'"
                />
              </div>
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2 text-sm">
                <span class="truncate font-semibold" :class="group.primary.status === 'MISSING' ? 'text-zinc-500' : 'text-zinc-50'">
                  {{ group.primary.title }}
                </span>
                <span v-if="group.primary.year" class="text-xs text-zinc-500">{{ group.primary.year }}</span>
                <span
                  v-if="group.releases.length > 1"
                  class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
                >{{ group.releases.length }} editions</span>
              </div>
              <div class="mt-0.5 flex items-center gap-3 text-xs" :class="group.primary.status === 'MISSING' ? 'text-zinc-600' : 'text-zinc-400'">
                <span v-if="group.primary.type">{{ group.primary.type }}</span>
                <span v-if="group.totalTracks">· {{ group.totalTracks }} tracks</span>
                <span v-if="group.primary.coArtists?.length" class="text-zinc-500">Feat.
                  <template v-for="(co, i) in group.primary.coArtists" :key="co.slug">
                    <NuxtLink
                      :to="`/artist/${co.slug}`"
                      class="text-zinc-400 transition-colors hover:text-amber-500"
                      @click.stop
                    >{{ co.name }}</NuxtLink><template v-if="i < group.primary.coArtists.length - 1">, </template>
                  </template>
                </span>
                <span v-if="group.totalPlayCount">· {{ group.totalPlayCount.toLocaleString() }} plays</span>
              </div>
            </div>

            <ReleaseStatusMulti :releases="group.releases" />

          </div>

          <div v-if="expandedGroup === group.key" @click.stop>
            <div class="ml-8 border-l-2 border-zinc-800">
                <div
                  v-for="edition in group.releases"
                  :key="edition.id"
                  :data-release-id="edition.id"
                  class="border-b border-zinc-800 last:border-b-0"
                  :class="edition.status === 'MISSING' ? '' : 'hover:bg-zinc-800/30'"
                >
                  <div
                    class="group/edition flex cursor-pointer items-center gap-3 px-3 py-2.5"
                    @click="toggleEdition(edition.id)"
                  >
                    <button
                      type="button"
                      class="flex size-5 items-center justify-center text-zinc-500"
                      @click.stop="toggleEdition(edition.id)"
                    >
                      <ChevronDown v-if="expandedEdition === edition.id" :size="14" />
                      <ChevronRight v-else :size="14" />
                    </button>
                    <div
                      class="group/folder relative flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-zinc-700 text-zinc-500 transition-colors"
                      :class="isCurrentRelease(edition) ? 'border-amber-500/50 text-amber-500' : 'hover:border-zinc-500'"
                      @click.stop="(edition.localReleaseId || edition.localTrackCount > 0) && handleReleaseClick(edition)"
                    >
                      <FolderClosed :size="14" />
                      <div
                        v-if="edition.localReleaseId || edition.localTrackCount > 0"
                        class="absolute inset-0 flex items-center justify-center bg-zinc-900/70 transition-colors group-hover/folder:bg-zinc-900/95"
                      >
                        <Pause v-if="isReleasePlaying(edition)" :size="12" fill="currentColor" class="text-amber-500" />
                        <Play
                          v-else
                          :size="12"
                          fill="currentColor"
                          :class="isCurrentRelease(edition) ? 'text-amber-500' : 'text-zinc-400 group-hover/folder:text-zinc-100'"
                        />
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-baseline gap-2 text-sm">
                        <span class="truncate" :class="edition.status === 'MISSING' ? 'text-zinc-500' : 'text-zinc-200'">
                          {{ editionDisplayTitle(edition) }}
                        </span>
                        <span v-if="edition.year" class="text-xs">({{ edition.year }})</span>
                      </div>
                      <div class="text-xs" :class="edition.status === 'MISSING' ? 'text-zinc-600' : 'text-zinc-500'">
                        <span v-if="edition.trackCount">{{ edition.trackCount }} tracks</span>
                        <span v-if="edition.localTrackCount && edition.trackCount !== edition.localTrackCount" class="ml-2">
                          {{ edition.localTrackCount }} local
                        </span>
                      </div>
                    </div>

                    <Popover trigger="hover">
                      <template #trigger>
                        <ReleaseStatusBadge :status="edition.status" />
                      </template>
                      <template #content>
                        <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                          <p class="text-xs text-zinc-400">{{ edition.statusReason || statusDescription(edition.status) }}</p>
                        </div>
                      </template>
                    </Popover>

                    <button
                      v-if="edition.status === 'MISSING' && downloadsStore.anyConfigured"
                      type="button"
                      class="rounded-full p-1.5 text-zinc-500 transition-colors hover:text-amber-500"
                      title="Download this release"
                      @click.stop="openDownloadDialog(edition)"
                    >
                      <Download :size="14" />
                    </button>

                    <button
                      v-if="edition.isMusicBrainz"
                      type="button"
                      class="rounded-full p-1.5 text-zinc-500 transition-colors hover:text-amber-500"
                      :class="{ 'text-amber-500': favoriteReleases.has(edition.id) }"
                      @click.stop="toggleFavoriteRelease(edition)"
                    >
                      <Heart :size="14" :fill="favoriteReleases.has(edition.id) ? 'currentColor' : 'none'" />
                    </button>

                    <a
                      v-if="edition.musicbrainzId"
                      :href="`https://musicbrainz.org/release/${edition.musicbrainzId}`"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="rounded-full p-1.5 text-zinc-600 transition-colors hover:text-zinc-400"
                      title="View on MusicBrainz"
                      @click.stop
                    >
                      <Link :size="14" />
                    </a>

                  </div>

                  <div v-if="expandedEdition === edition.id && (edition.localReleaseId || edition.localTrackCount > 0)" class="border-t border-zinc-800 px-3 pb-3" @click.stop>
                    <ReleaseTracksTable :release-id="edition.localReleaseId || edition.mbReleaseRowId || edition.id" :columns="releaseTrackColumns" />
                  </div>
                </div>
            </div>
          </div>
        </div>
      </Table>

      <div v-if="sortedGroups.length === 0" class="py-8 text-center text-sm text-zinc-500">
        No releases in this category
      </div>
    </template>

    <template v-else>
      <div v-if="allTracksLoading" class="py-8 text-center text-sm text-zinc-500">
        Loading all tracks...
      </div>
      <div v-else-if="filteredAllTracks.length === 0" class="py-8 text-center text-sm text-zinc-500">
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
  </div>
</template>
