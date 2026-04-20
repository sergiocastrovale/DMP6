<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { IssueColumn, IssueType } from '~/types/issues'

const route = useRoute()
const type = route.params.type as IssueType

const VALID_TYPES: IssueType[] = ['corrupted', 'unsplit', 'orphans', 'duplicates', 'missing', 'enrichment']
if (!VALID_TYPES.includes(type)) {
  throw createError({ statusCode: 404, message: 'Unknown issue type' })
}

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const selected = ref<Set<string>>(new Set())
const searchInput = ref('')
const searchDebounce = ref<ReturnType<typeof setTimeout>>()
const showReindexButton = ref(false)
const affectedArtists = ref<string[]>([])
const hasFixed = ref(false)

const FILE_WRITING_TYPES: IssueType[] = ['corrupted', 'unsplit', 'missing']

onMounted(() => {
  issuesStore.fetchSummary()
  issuesStore.fetchType(type, true)
})

function onSearch(q: string) {
  clearTimeout(searchDebounce.value)
  searchDebounce.value = setTimeout(() => issuesStore.setSearch(type, q), 350)
}

watch(searchInput, onSearch)

async function fixSelected() {
  const ids = [...selected.value]
  if (!ids.length) return

  // Capture affected artist names before clearing selection
  const items = issuesStore.items[type] ?? []
  const selectedItems = items.filter((i: any) => selected.value.has(i.id))
  const artistNames = new Set<string>()
  for (const item of selectedItems) {
    if (type === 'corrupted') {
      const name = item.artist?.name
      if (name) artistNames.add(name)
    } else if (type === 'unsplit') {
      const name = item.artist?.name
      if (name) artistNames.add(name)
    }
    // 'missing' intentionally left unscoped (albumArtist may itself be missing)
  }
  affectedArtists.value = [...artistNames]

  selected.value = new Set()
  await issuesStore.queueIds(type, ids)
  hasFixed.value = true
  terminal.run('./fix', [`--${type}`], `fix`)
  terminal.open()
}

watch(
  () => terminal.exitCode,
  (code) => {
    if (code === 0 && !terminal.isRunning && hasFixed.value) {
      hasFixed.value = false
      issuesStore.fetchType(type, true)
      issuesStore.fetchSummary()
      if (FILE_WRITING_TYPES.includes(type)) {
        showReindexButton.value = true
      }
    }
  },
  { immediate: true },
)

const PAGE_SIZE = 50

const columns = computed<IssueColumn[]>(() => {
  switch (type) {
    case 'corrupted': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'currentValue', label: 'Current Value', sortable: true },
      { key: 'proposedValue', label: 'Proposed Fix', sortable: false, editable: true, editKey: 'proposedValue' },
      { key: 'confidence', label: 'Confidence', sortable: true },
      { key: 'track.filePath', label: 'File', sortable: false },
    ]
    case 'unsplit': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'artist.totalTracks', label: 'Tracks', sortable: false, width: 'w-16' },
      { key: 'separator', label: 'Separator', sortable: true, width: 'w-20' },
      { key: 'proposedParts', label: 'Proposed Split', sortable: false, editable: false },
    ]
    case 'orphans': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'reason', label: 'Reason', sortable: true },
      { key: 'artist.createdAt', label: 'Created', sortable: false },
      { key: 'artist.musicbrainzId', label: 'MB Synced', sortable: false },
    ]
    case 'duplicates': return [
      { key: 'artistA.name', label: 'Keep (A)', sortable: false },
      { key: 'artistA.totalTracks', label: 'A Tracks', sortable: false, width: 'w-20' },
      { key: 'artistB.name', label: 'Merge (B)', sortable: false },
      { key: 'artistB.totalTracks', label: 'B Tracks', sortable: false, width: 'w-20' },
    ]
    case 'missing': return [
      { key: 'track.title', label: 'Title', sortable: false },
      { key: 'track.artist', label: 'Artist', sortable: false },
      { key: 'track.album', label: 'Album', sortable: false },
      { key: 'missingFields', label: 'Missing', sortable: false },
      { key: 'proposedValues', label: 'Proposed', sortable: false },
    ]
    case 'enrichment': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'localRelease.title', label: 'Release', sortable: true },
      { key: 'localRelease.year', label: 'Year', sortable: true, width: 'w-16' },
      { key: 'missingFields', label: 'Missing', sortable: false },
      { key: '_resync', label: '', sortable: false, width: 'w-24' },
    ]
  }
})

const typeLabels: Record<IssueType, string> = {
  corrupted: 'Corrupted TPE2',
  unsplit: 'Unsplit Artists',
  orphans: 'Orphan Artists',
  duplicates: 'Duplicate Artists',
  missing: 'Missing Metadata',
  enrichment: 'Enrichment Gaps',
}

async function onEdit(id: string, key: string, value: unknown) {
  await issuesStore.patchIssue(type, id, { [key]: value })
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString()
}
</script>

<template>
  <div class="flex flex-col pb-24">
    <IssuesIssueTypeTabs :current="type" />

    <div class="p-6">
      <!-- Header row -->
      <div class="mb-4 flex items-center justify-between gap-4">
        <h1 class="text-lg font-semibold text-white">{{ typeLabels[type] }}</h1>
        <div class="flex items-center gap-2">
          <UiRefreshButton v-if="showReindexButton" :only="affectedArtists.length ? affectedArtists : undefined" />
          <div class="relative">
            <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              v-model="searchInput"
              type="text"
              placeholder="Search..."
              class="rounded border border-zinc-700 bg-zinc-900 py-1.5 pl-8 pr-3 text-sm text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
          </div>
        </div>
      </div>

      <!-- Table -->
      <div class="rounded-lg border border-zinc-800 bg-zinc-950">
        <IssuesIssueTable
          :type="type"
          :columns="columns"
          :items="issuesStore.items[type] ?? []"
          :total="issuesStore.total[type] ?? 0"
          :page="issuesStore.page[type] ?? 1"
          :page-size="PAGE_SIZE"
          :loading="issuesStore.pageLoading[type] ?? false"
          :sort="issuesStore.sort[type]"
          :order="issuesStore.order[type]"
          :selected="selected"
          @update:selected="selected = $event"
          @sort="issuesStore.setSort(type, $event)"
          @page="issuesStore.setPage(type, $event)"
          @edit="onEdit"
        >
          <!-- Corrupted: artist link (key: artist.name → slot: cell-artist_name) -->
          <template #cell-artist_name="{ item }">
            <NuxtLink
              v-if="item.artist"
              :to="`/artist/${item.artist.slug}`"
              class="text-blue-400 hover:underline"
            >
              {{ item.artist.name }}
            </NuxtLink>
            <span v-else class="text-zinc-600">—</span>
          </template>

          <!-- Corrupted: confidence badge -->
          <template #cell-confidence="{ item }">
            <IssuesConfidenceBadge :confidence="item.confidence" />
          </template>

          <!-- Corrupted: truncated file path (key: track.filePath → slot: cell-track_filePath) -->
          <template #cell-track_filePath="{ item }">
            <span class="truncate text-xs text-zinc-500" :title="item.track.filePath">
              {{ item.track.filePath?.split('/').slice(-2).join('/') }}
            </span>
          </template>

          <!-- Unsplit: proposed parts as tag list -->
          <template #cell-proposedParts="{ item }">
            <div class="flex flex-wrap gap-1">
              <span
                v-for="part in item.proposedParts"
                :key="part"
                class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
              >{{ part }}</span>
            </div>
          </template>

          <!-- Orphans: reason badge -->
          <template #cell-reason="{ item }">
            <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{{ item.reason }}</span>
          </template>

          <!-- Orphans: created date (key: artist.createdAt → slot: cell-artist_createdAt) -->
          <template #cell-artist_createdAt="{ item }">
            <span class="text-xs text-zinc-500">{{ formatDate(item.artist.createdAt) }}</span>
          </template>

          <!-- Orphans: MB synced (key: artist.musicbrainzId → slot: cell-artist_musicbrainzId) -->
          <template #cell-artist_musicbrainzId="{ item }">
            <span :class="item.artist.musicbrainzId ? 'text-green-500' : 'text-zinc-600'">
              {{ item.artist.musicbrainzId ? 'Yes' : 'No' }}
            </span>
          </template>

          <!-- Duplicates: artist A link (key: artistA.name → slot: cell-artistA_name) -->
          <template #cell-artistA_name="{ item }">
            <NuxtLink :to="`/artist/${item.artistA.slug}`" class="text-blue-400 hover:underline">
              {{ item.artistA.name }}
            </NuxtLink>
          </template>

          <!-- Duplicates: artist B link (key: artistB.name → slot: cell-artistB_name) -->
          <template #cell-artistB_name="{ item }">
            <NuxtLink :to="`/artist/${item.artistB.slug}`" class="text-blue-400 hover:underline">
              {{ item.artistB.name }}
            </NuxtLink>
          </template>

          <!-- Missing: missing fields / Enrichment: EnrichmentFieldBadge chips -->
          <template #cell-missingFields="{ item }">
            <div class="flex flex-wrap gap-1">
              <template v-if="type === 'enrichment'">
                <IssuesEnrichmentFieldBadge
                  v-for="f in item.missingFields"
                  :key="f"
                  :field="f"
                />
              </template>
              <template v-else>
                <span
                  v-for="f in item.missingFields"
                  :key="f"
                  class="rounded bg-red-900/30 px-1.5 py-0.5 text-xs text-red-400"
                >{{ f }}</span>
              </template>
            </div>
          </template>

          <!-- Missing: proposed values summary -->
          <template #cell-proposedValues="{ item }">
            <span v-if="item.proposedValues" class="text-xs text-green-500">
              {{ Object.keys(item.proposedValues).join(', ') }}
            </span>
            <span v-else class="text-xs text-zinc-600">manual</span>
          </template>

          <!-- Enrichment: release title link (key: localRelease.title) -->
          <template #cell-localRelease_title="{ item }">
            <NuxtLink
              v-if="item.localRelease"
              :to="`/artist/${item.artist?.slug}`"
              class="text-zinc-200 hover:underline"
            >
              {{ item.localRelease.title }}
            </NuxtLink>
            <span v-else class="text-zinc-600">—</span>
          </template>

          <!-- Enrichment: Re-sync button for MB-unlinked releases -->
          <template #cell__resync="{ item }">
            <UiRefreshButton
              v-if="item.missingFields?.includes('mbRelease') && item.artist"
              :only="[item.artist.name]"
            />
          </template>
        </IssuesIssueTable>
      </div>
    </div>

    <!-- Selection bar (not shown for enrichment — no automated fix) -->
    <IssuesSelectionBar
      v-if="type !== 'enrichment'"
      :count="selected.size"
      :type="type"
      :loading="terminal.isRunning"
      @fix="fixSelected"
    />
  </div>
</template>
