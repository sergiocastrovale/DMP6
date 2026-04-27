<script setup lang="ts">
import { Play, Pause, LayoutList, LayoutGrid, HelpCircle, Disc3, Loader2, Link, Heart, Download } from 'lucide-vue-next'
import type { UnifiedRelease, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/components/TrackList.vue'
import type { ButtonDropdownOption } from '~/components/ButtonDropdown.vue'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'

function statusDescription(status: string) {
  return statuses.find(s => s.value === status)?.description ?? ''
}

const props = defineProps<{
  slug: string
  artistName?: string
}>()

const route = useRoute()
const player = usePlayerStore()
const { playRelease: playReleaseById, isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId, toggleOrPlay } = usePlayRelease()
const { releaseImage } = useImageUrl()

const releases = ref<UnifiedRelease[]>([])
const loading = ref(true)

const searchQuery = ref('')
const statusFilter = ref<string | null>(null)
const showMissing = ref(true)
const viewMode = ref<'catalogue' | 'list'>('catalogue')
const expandedRelease = ref<string | null>(null)
const allTracks = ref<Track[]>([])
const allTracksLoading = ref(false)
const allTracksLoaded = ref(false)

// Downloads
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()
const downloadRelease = ref<UnifiedRelease | null>(null)
const showDownloadDialog = ref(false)

function toReleaseSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function openDownloadDialog(release: UnifiedRelease) {
  downloadRelease.value = release
  showDownloadDialog.value = true
}

const missingReleasesInTab = computed(() =>
  filteredReleases.value.filter(r => r.status === 'MISSING'),
)

const downloadAllOptions = computed<ButtonDropdownOption[]>(() => {
  const missing = missingReleasesInTab.value
  if (missing.length === 0) return []

  const artist = props.artistName || ''
  const opts: ButtonDropdownOption[] = []
  if (downloadsStore.slskd.connected) {
    opts.push({
      label: `Soulseek (${missing.length})`,
      description: `Search & download ${missing.length} missing releases`,
      action: () => {
        const first = missing[0]
        if (first) terminal.runDownload('slskd', `${artist} ${first.title}`, first.title, artist, first.year)
      },
    })
  }
  if (downloadsStore.hifi.connected) {
    opts.push({
      label: `HiFi (${missing.length})`,
      description: `Free FLAC lossless — no account needed`,
      action: () => {
        const first = missing[0]
        if (first) terminal.runDownload('hifi', `${artist} ${first.title}`, first.title, artist, first.year)
      },
    })
  }
  if (downloadsStore.deezer.connected) {
    opts.push({
      label: `Deezer (${missing.length})`,
      description: `Download ${missing.length} missing releases from Deezer`,
      action: () => {
        const first = missing[0]
        if (first) terminal.runDownload('deezer', `${artist} ${first.title}`, first.title, artist, first.year)
      },
    })
  }
  return opts
})

onMounted(async () => {
  downloadsStore.checkStatus()
  try {
    const data = await $fetch<{ releases: UnifiedRelease[] }>(
      `/api/artists/${props.slug}/releases`,
      { query: { pageSize: 500 } },
    )
    releases.value = data.releases
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
    handleReleaseDeepLink()
  }
})

async function handleReleaseDeepLink() {
  const targetSlug = route.query.release as string | undefined
  if (!targetSlug) return
  await nextTick()
  const release = releases.value.find(r => toReleaseSlug(r.title) === targetSlug)
  if (!release) return
  activeTab.value = release.typeSlug
  await nextTick()
  expandedRelease.value = release.id
  await nextTick()
  document.querySelector(`[data-release-id="${release.id}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const favoriteReleases = ref<Set<string>>(new Set())

onMounted(async () => {
  try {
    const data = await $fetch<any>('/api/favorites', { query: { type: 'releases', pageSize: 100 } })
    if (data?.releases) {
      favoriteReleases.value = new Set(data.releases.map((f: any) => f.release.id))
    }
  }
  catch { /* ignore */ }
})

async function toggleFavoriteRelease(release: UnifiedRelease) {
  if (!release.isMusicBrainz) return
  const isFavorite = favoriteReleases.value.has(release.id)
  try {
    await $fetch(`/api/favorites/releases/${release.id}`, {
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


const filteredByStatus = computed(() => {
  let result = releases.value
  if (!showMissing.value) {
    result = result.filter(r => r.status !== 'MISSING')
  }
  if (statusFilter.value) {
    result = result.filter(r => r.status === statusFilter.value)
  }
  return result
})

const types = computed(() => {
  const typeMap = new Map<string, { name: string; slug: string; count: number }>()
  for (const r of filteredByStatus.value) {
    const existing = typeMap.get(r.typeSlug)
    if (existing) {
      existing.count++
    }
    else {
      typeMap.set(r.typeSlug, { name: r.type, slug: r.typeSlug, count: 1 })
    }
  }
  return Array.from(typeMap.values()).sort((a, b) => a.name.localeCompare(b.name))
})

const activeTab = ref('')

watch(types, (newTypes) => {
  if (newTypes.length && !newTypes.find(t => t.slug === activeTab.value)) {
    activeTab.value = newTypes[0]?.slug || ''
  }
}, { immediate: true })

const filteredReleases = computed(() => {
  let result = filteredByStatus.value.filter(r => r.typeSlug === activeTab.value)
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(r => r.title.toLowerCase().includes(q))
  }
  return result
})

const releaseMap = computed(() => {
  const map: Record<string, { title: string; status: ReleaseStatus; image: string | null; imageUrl: string | null }> = {}
  for (const r of releases.value) {
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
      releases.value
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

function toggleExpand(id: string) {
  expandedRelease.value = expandedRelease.value === id ? null : id
}

const getReleaseId = (release: UnifiedRelease) => release.localReleaseId || release.id
const isCurrentRelease = (release: UnifiedRelease) => isCurrentReleaseId(getReleaseId(release))
const isReleasePlaying = (release: UnifiedRelease) => isReleasePlayingId(getReleaseId(release))
const handleReleaseClick = (release: UnifiedRelease) => toggleOrPlay(getReleaseId(release), props.slug)

let allTracksSlug = ''
async function loadAllTracks() {
  if (allTracksLoaded.value && allTracksSlug === props.slug) return
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
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="flex items-center justify-center py-12">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <ArtistTrackSearch v-model="searchQuery" />

        <Dropdown
          v-model="statusFilter"
          :options="statuses"
          placeholder="Status"
        />

        <div class="flex-1" />

        <div class="flex items-center rounded-lg border border-zinc-700 bg-zinc-900">
          <button
            class="rounded-l-lg px-2.5 py-1.5 transition-colors"
            :class="viewMode === 'catalogue' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50'"
            title="Catalogue view"
            @click="viewMode = 'catalogue'"
          >
            <LayoutGrid :size="16" />
          </button>
          <button
            class="rounded-r-lg px-2.5 py-1.5 transition-colors"
            :class="viewMode === 'list' ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50'"
            title="List view"
            @click="switchToListView()"
          >
            <LayoutList :size="16" />
          </button>
        </div>
      </div>

      <template v-if="viewMode === 'catalogue'">
        <div v-if="types.length > 1" class="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
          <button
            v-for="type in types"
            :key="type.slug"
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              activeTab === type.slug
                ? 'bg-zinc-800 text-amber-500'
                : 'text-zinc-400 hover:text-zinc-50'
            "
            @click="activeTab = type.slug"
          >
            {{ type.name }}
            <span class="ml-1 text-xs text-zinc-500">{{ type.count }}</span>
          </button>
        </div>

        <TableHeader>
          <div class="w-10 shrink-0" />
          <div class="w-10 shrink-0" />
          <div class="min-w-0 flex-1" />
          <ButtonDropdown
            v-if="downloadsStore.anyConfigured && missingReleasesInTab.length > 0 && showMissing"
            label="Download missing"
            :options="downloadAllOptions"
          >
            <template #icon>
              <Download :size="14" />
            </template>
          </ButtonDropdown>
          <Switch v-model="showMissing" label="Show missing" />
          <div class="flex items-center gap-1 shrink-0">
            <span>Status</span>
            <Popover trigger="hover">
              <template #trigger>
                <button class="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <HelpCircle :size="12" />
                </button>
              </template>
              <template #content>
                <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                  <p class="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Release Statuses</p>
                  <div class="flex flex-col gap-2">
                    <div v-for="s in statuses" :key="s.value" class="flex flex-col gap-1">
                      <span :class="s.classes" class="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                        {{ s.label }}
                      </span>
                      <p class="text-xs text-zinc-400">{{ s.description }}</p>
                    </div>
                  </div>
                </div>
              </template>
            </Popover>
          </div>
        </TableHeader>

        <Table>
          <TableRow
            v-for="release in filteredReleases"
            :key="release.id"
            :data-release-id="release.id"
            :muted="release.status === 'MISSING'"
            :expanded="expandedRelease === release.id"
            class="cursor-pointer"
            @click="toggleExpand(release.id)"
          >
            <button
              v-if="release.localReleaseId || release.localTrackCount > 0"
              class="flex size-10 flex-shrink-0 items-center justify-center text-sm"
              :class="isCurrentRelease(release) ? 'text-amber-500' : 'text-zinc-500 group-hover:text-amber-500'"
              @click.stop="handleReleaseClick(release)"
            >
              <Pause v-if="isReleasePlaying(release)" :size="16" fill="currentColor" />
              <Play v-else :size="16" fill="currentColor" />
            </button>
            <div v-else class="size-10 flex-shrink-0" />

            <div class="relative size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
              <img
                v-if="releaseImage(release)"
                :src="releaseImage(release)!"
                :alt="release.title"
                class="size-full object-cover"
                loading="lazy"
              />
              <div v-else class="flex size-full items-center justify-center text-zinc-600">
                <Disc3 :size="20" />
              </div>
            </div>

            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium" :class="release.status === 'MISSING' ? 'text-zinc-500' : 'text-zinc-50'">
                {{ release.title }}
                <span v-if="release.disambiguation" class="ml-1 text-xs font-normal text-zinc-500">({{ release.disambiguation }})</span>
              </div>

              <div class="flex items-center gap-3 text-xs" :class="release.status === 'MISSING' ? 'text-zinc-600' : 'text-zinc-400'">
                <span v-if="release.year">{{ release.year }}</span>
                <span v-if="release.trackCount">{{ release.trackCount }} tracks</span>
                <span v-if="release.localTrackCount && release.trackCount !== release.localTrackCount">
                  {{ release.localTrackCount }} local
                </span>
                <span v-if="release.coArtists?.length" class="text-zinc-500">Feat.
                  <template v-for="(co, i) in release.coArtists" :key="co.slug">
                    <NuxtLink
                      :to="`/artist/${co.slug}`"
                      class="text-zinc-400 hover:text-amber-500 transition-colors"
                      @click.stop
                    >{{ co.name }}</NuxtLink><template v-if="i < release.coArtists.length - 1">, </template>
                  </template>
                </span>
                <span v-if="release.totalPlayCount">{{ release.totalPlayCount.toLocaleString() }} plays</span>
              </div>
            </div>

            <Popover trigger="hover">
              <template #trigger>
                <ReleaseStatusBadge :status="release.status" />
              </template>
              <template #content>
                <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                  <p class="text-xs text-zinc-400">{{ release.statusReason || statusDescription(release.status) }}</p>
                </div>
              </template>
            </Popover>

            <button
              v-if="release.status === 'MISSING' && downloadsStore.anyConfigured"
              class="rounded-full p-1.5 text-zinc-500 transition-colors hover:text-amber-500"
              title="Download this release"
              @click.stop="openDownloadDialog(release)"
            >
              <Download :size="14" />
            </button>

            <button
              v-if="release.isMusicBrainz"
              class="rounded-full p-1.5 text-zinc-500 transition-colors hover:text-amber-500"
              :class="{ 'text-amber-500': favoriteReleases.has(release.id) }"
              @click.stop="toggleFavoriteRelease(release)"
            >
              <Heart :size="14" :fill="favoriteReleases.has(release.id) ? 'currentColor' : 'none'" />
            </button>

            <a
              v-if="release.musicbrainzId"
              :href="`https://musicbrainz.org/release/${release.musicbrainzId}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rounded-full p-1.5 text-zinc-600 transition-colors hover:text-zinc-400"
              title="View on MusicBrainz"
              @click.stop
            >
              <Link :size="14" />
            </a>

            <template #expand>
              <div v-if="expandedRelease === release.id && (release.localReleaseId || release.localTrackCount > 0)" class="border-t border-zinc-800 px-3 pb-3" @click.stop>
                <ReleaseTracksTable :release-id="release.isMusicBrainz ? release.id : (release.localReleaseId || release.id)" :columns="releaseTrackColumns" />
              </div>
            </template>
          </TableRow>
        </Table>

        <div v-if="filteredReleases.length === 0" class="py-8 text-center text-sm text-zinc-500">
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
