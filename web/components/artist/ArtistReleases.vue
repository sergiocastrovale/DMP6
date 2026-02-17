<script setup lang="ts">
import { Play, Search, LayoutList, LayoutGrid, HelpCircle, Disc3 } from 'lucide-vue-next'
import type { UnifiedRelease, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import type { TrackListColumn } from '~/components/TrackList.vue'
import { usePlayerStore } from '~/stores/player'
import { statuses } from '~/helpers/constants'

const props = defineProps<{
  releases: UnifiedRelease[]
  slug: string
}>()

const player = usePlayerStore()

const searchQuery = ref('')
const statusFilter = ref<string | null>(null)
const viewMode = ref<'catalogue' | 'list'>('catalogue')
const expandedRelease = ref<string | null>(null)
const showStatusHelp = ref(false)
const allTracks = ref<Track[]>([])
const allTracksLoading = ref(false)
const allTracksLoaded = ref(false)

const filteredByStatus = computed(() => {
  if (!statusFilter.value) return props.releases
  return props.releases.filter(r => r.status === statusFilter.value)
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
  return Array.from(typeMap.values())
})

const activeTab = ref('')

watch(types, (newTypes) => {
  if (newTypes.length && !newTypes.find(t => t.slug === activeTab.value)) {
    activeTab.value = newTypes[0]?.slug || ''
  }
}, { immediate: true })

const filteredReleases = computed(() => {
  return filteredByStatus.value.filter(r => r.typeSlug === activeTab.value)
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
  { key: 'favorite' },
  { key: 'duration' },
]

const releaseTrackColumns: TrackListColumn[] = [
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'favorite' },
  { key: 'duration' },
]

function toggleExpand(id: string) {
  expandedRelease.value = expandedRelease.value === id ? null : id
}

async function playRelease(release: UnifiedRelease) {
  const releaseId = release.localReleaseId || release.id
  try {
    const data = await $fetch<any>(`/api/releases/${releaseId}/tracks`)
    if (data?.tracks?.length) {
      const playerTracks = data.tracks.map((t: any) => ({
        id: t.id,
        title: t.title || 'Unknown',
        artist: t.artist || 'Unknown',
        album: t.album || release.title,
        duration: t.duration || 0,
        artistSlug: props.slug,
        releaseImage: data.release?.image ? `/img/releases/${data.release.image}` : null,
        releaseImageUrl: data.release?.imageUrl || null,
        localReleaseId: t.localReleaseId,
      }))
      player.setQueue(playerTracks)
    }
  }
  catch { /* ignore */ }
}

async function loadAllTracks() {
  if (allTracksLoaded.value) return
  allTracksLoading.value = true
  try {
    allTracks.value = await $fetch<Track[]>(`/api/artists/${props.slug}/tracks`)
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

let searchTimeout: ReturnType<typeof setTimeout>
function handleSearch(value: string) {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    searchQuery.value = value
    if (value) {
      switchToListView()
    }
  }, 300)
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
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 sm:max-w-xs">
        <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder="Search tracks..."
          class="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-8 pr-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          @input="handleSearch(($event.target as HTMLInputElement).value)"
        />
      </div>

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

      <div class="flex items-center gap-4 px-3 text-xs text-zinc-500">
        <div class="w-10 shrink-0" />
        <div class="min-w-0 flex-1" />
        <div class="relative flex items-center gap-1 shrink-0">
          <span>Status</span>
          <button class="text-zinc-500 hover:text-zinc-300 transition-colors" @click="showStatusHelp = !showStatusHelp">
            <HelpCircle :size="12" />
          </button>
          <div
            v-if="showStatusHelp"
            class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
          >
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
        </div>
      </div>
      <div v-if="showStatusHelp" class="fixed inset-0 z-10" @click="showStatusHelp = false" />

      <div class="flex flex-col gap-1">
        <div
          v-for="release in filteredReleases"
          :key="release.id"
          class="rounded-lg border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700"
        >
          <div
            class="flex cursor-pointer items-center gap-4 p-3"
            @click="toggleExpand(release.id)"
          >
            <div class="group/cover relative size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
              <img
                v-if="release.image || release.imageUrl"
                :src="release.imageUrl || release.image!"
                :alt="release.title"
                class="size-full object-cover"
                loading="lazy"
              />
              <div v-else class="flex size-full items-center justify-center text-zinc-600">
                <Disc3 :size="20" />
              </div>
              <button
                v-if="release.localReleaseId || release.localTrackCount > 0"
                class="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/cover:opacity-100"
                @click.stop="playRelease(release)"
              >
                <Play :size="14" class="text-zinc-50" />
              </button>
            </div>

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-zinc-50">{{ release.title }}</p>
              <div class="flex items-center gap-3 text-xs text-zinc-400">
                <span v-if="release.year">{{ release.year }}</span>
                <span v-if="release.trackCount">{{ release.trackCount }} tracks</span>
                <span v-if="release.localTrackCount && release.trackCount !== release.localTrackCount">
                  {{ release.localTrackCount }} local
                </span>
              </div>
            </div>

            <ReleaseStatusBadge :status="release.status" />
          </div>

          <div v-if="expandedRelease === release.id && (release.localReleaseId || release.localTrackCount > 0)" class="border-t border-zinc-800 px-3 pb-3">
            <ReleaseTracksTable :release-id="release.localReleaseId || release.id" :columns="releaseTrackColumns" />
          </div>
        </div>
      </div>

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
  </div>
</template>
