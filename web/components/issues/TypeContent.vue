<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { IssueColumn, IssueType } from '~/types/issues'

const props = defineProps<{ type: IssueType }>()

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const selected = ref<Set<string>>(new Set())
const selectedResolved = ref<Set<string>>(new Set())
const searchInput = ref('')
const searchDebounce = ref<ReturnType<typeof setTimeout>>()
const showReindexButton = ref(false)
const affectedArtists = ref<string[]>([])
const hasFixed = ref(false)
const hasReverted = ref(false)

const FILE_WRITING_TYPES: IssueType[] = ['corrupted', 'unsplit', 'missing', 'duplicates']
const REVERTABLE_TYPES: IssueType[] = ['corrupted', 'unsplit', 'missing']

const activeSubtab = ref<'detected' | 'fixed'>('detected')

onMounted(() => {
  issuesStore.fetchSummary()
  issuesStore.fetchType(props.type, true)
  if (REVERTABLE_TYPES.includes(props.type)) {
    issuesStore.fetchResolved(props.type, true)
  }
})

watch(searchInput, (q) => {
  clearTimeout(searchDebounce.value)
  searchDebounce.value = setTimeout(() => issuesStore.setSearch(props.type, q), 350)
})

async function fixSelected() {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }

  const items = issuesStore.items[props.type] ?? []
  const selectedItems = items.filter((i: any) => selected.value.has(i.id))
  const artistNames = new Set<string>()
  for (const item of selectedItems) {
    if (props.type === 'corrupted' || props.type === 'unsplit') {
      const name = item.artist?.name
      if (name) {
        artistNames.add(name)
      }
    } else if (props.type === 'duplicates') {
      if (item.artistA?.name) {
        artistNames.add(item.artistA.name)
      }
      if (item.artistB?.name) {
        artistNames.add(item.artistB.name)
      }
    }
  }
  affectedArtists.value = [...artistNames]

  selected.value = new Set()
  await issuesStore.queueIds(props.type, ids)
  hasFixed.value = true
  terminal.run('./fix', [`--${props.type}`], `fix`)
  terminal.open()
}

async function revertSelected(mode: 'undo' | 'undo-resolved') {
  const ids = [...selectedResolved.value]
  if (!ids.length) {
    return
  }

  const items = issuesStore.resolvedItems[props.type] ?? []
  const selectedItems = items.filter((i: any) => selectedResolved.value.has(i.id))
  const artistNames = new Set<string>()
  for (const item of selectedItems) {
    const name = item.artist?.name
    if (name) {
      artistNames.add(name)
    }
  }
  affectedArtists.value = [...artistNames]

  selectedResolved.value = new Set()
  await issuesStore.queueRevert(props.type, ids, mode)
  hasReverted.value = true
  terminal.run('./fix', ['--revert', `--${props.type}`, `--mode=${mode}`], `fix`)
  terminal.open()
}

watch(
  () => terminal.exitCode,
  (code) => {
    if (code === 0 && !terminal.isRunning) {
      if (hasFixed.value) {
        hasFixed.value = false
        issuesStore.fetchType(props.type, true)
        issuesStore.fetchResolved(props.type, true)
        issuesStore.fetchSummary()
        if (FILE_WRITING_TYPES.includes(props.type)) {
          showReindexButton.value = true
        }
      }
      if (hasReverted.value) {
        hasReverted.value = false
        issuesStore.fetchType(props.type, true)
        issuesStore.fetchResolved(props.type, true)
        issuesStore.fetchSummary()
        showReindexButton.value = true
      }
    }
  },
  { immediate: true },
)

const PAGE_SIZE = 50

const columns = computed<IssueColumn[]>(() => {
  switch (props.type) {
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

const resolvedColumns = computed<IssueColumn[]>(() => {
  switch (props.type) {
    case 'corrupted': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'track.filePath', label: 'File', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    case 'unsplit': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'previousValue', label: 'Original Name', sortable: false },
      { key: 'appliedValue', label: 'Split To', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    case 'missing': return [
      { key: 'track.title', label: 'Title', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'track.filePath', label: 'File', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    default: return []
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

const typeDescriptions: Record<IssueType, { detection: string; fix: string }> = {
  corrupted: {
    detection: 'Tracks where the album artist tag (TPE2) contains numeric garbage, bitrate markers, or file path fragments instead of an actual artist name.',
    fix: 'Rewrites the TPE2 tag in the original audio file with the proposed value, then requires a re-index to update the database.',
  },
  unsplit: {
    detection: 'Artists whose names contain separators like "&", "feat.", "vs." — indicating multiple artists stored as a single compound name.',
    fix: 'Splits the compound name into individual artist tags in the original audio files, then requires a re-index to create separate artist entries.',
  },
  orphans: {
    detection: 'Artists with no linked releases or tracks — either phantom entries with corrupted names (numeric/bitrate garbage) or fully disconnected records.',
    fix: 'Deletes the orphan artist record directly from the database. No files are modified.',
  },
  duplicates: {
    detection: 'Artist pairs whose names match after normalizing case and stripping punctuation, suggesting they represent the same artist.',
    fix: 'Rewrites artist and album artist tags in audio files from B to A, then merges all releases, tracks, and links in the database. Requires a re-index afterward.',
  },
  missing: {
    detection: 'Tracks missing one or more required metadata fields: title, artist, album artist, album, or year.',
    fix: 'Writes the proposed values into the original audio file tags, then requires a re-index to update the database.',
  },
  enrichment: {
    detection: 'Releases missing enrichment data: MusicBrainz link, BPM, mood, AcousticID, Discogs, Bandcamp, or Wikipedia URLs.',
    fix: 'Enrichment gaps are resolved by re-syncing with MusicBrainz or running external analysis tools. No automatic fix available — use the re-sync button where applicable.',
  },
}

async function onEdit(id: string, key: string, value: unknown) {
  await issuesStore.patchIssue(props.type, id, { [key]: value })
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString()
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getHistoryPreviousValue(item: any): string {
  const history = item.fixHistory?.[0]
  if (!history) {
    return '—'
  }
  const state = history.previousState as Record<string, unknown>
  return Object.values(state).filter(Boolean).join(', ') || '(empty)'
}

function getHistoryAppliedValue(item: any): string {
  const history = item.fixHistory?.[0]
  if (!history) {
    return '—'
  }
  const state = history.appliedState as Record<string, unknown>
  return Object.values(state).filter(Boolean).join(', ') || '(empty)'
}

function getHistoryDate(item: any): string {
  const history = item.fixHistory?.[0]
  return history ? formatDateTime(history.appliedAt) : '—'
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
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
      <p class="text-sm text-zinc-500">
        {{ typeDescriptions[type].detection }}
        <span class="text-zinc-600">Fix:</span> {{ typeDescriptions[type].fix }}
      </p>
    </div>

    <div v-if="REVERTABLE_TYPES.includes(type)" class="flex gap-1 border-b border-zinc-800">
      <button
        @click="activeSubtab = 'detected'"
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activeSubtab === 'detected' ? 'border-b-2 border-blue-500 text-white' : 'text-zinc-500 hover:text-zinc-300'"
      >
        Detected
        <span v-if="(issuesStore.total[type] ?? 0) > 0" class="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs">
          {{ issuesStore.total[type] }}
        </span>
      </button>
      <button
        @click="activeSubtab = 'fixed'"
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activeSubtab === 'fixed' ? 'border-b-2 border-green-500 text-white' : 'text-zinc-500 hover:text-zinc-300'"
      >
        Fixed
        <span v-if="(issuesStore.resolvedTotal[type] ?? 0) > 0" class="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs">
          {{ issuesStore.resolvedTotal[type] }}
        </span>
      </button>
    </div>

    <div v-if="activeSubtab === 'detected'" class="rounded-lg border border-zinc-800 bg-zinc-950">
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

        <template #cell-confidence="{ item }">
          <IssuesConfidenceBadge :confidence="item.confidence" />
        </template>

        <template #cell-track_filePath="{ item }">
          <span class="truncate text-xs text-zinc-500" :title="item.track.filePath">
            {{ item.track.filePath?.split('/').slice(-2).join('/') }}
          </span>
        </template>

        <template #cell-proposedParts="{ item }">
          <div class="flex flex-wrap gap-1">
            <span
              v-for="part in item.proposedParts"
              :key="part"
              class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
            >{{ part }}</span>
          </div>
        </template>

        <template #cell-reason="{ item }">
          <span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{{ item.reason }}</span>
        </template>

        <template #cell-artist_createdAt="{ item }">
          <span class="text-xs text-zinc-500">{{ formatDate(item.artist.createdAt) }}</span>
        </template>

        <template #cell-artist_musicbrainzId="{ item }">
          <span :class="item.artist.musicbrainzId ? 'text-green-500' : 'text-zinc-600'">
            {{ item.artist.musicbrainzId ? 'Yes' : 'No' }}
          </span>
        </template>

        <template #cell-artistA_name="{ item }">
          <NuxtLink :to="`/artist/${item.artistA.slug}`" class="text-blue-400 hover:underline">
            {{ item.artistA.name }}
          </NuxtLink>
        </template>

        <template #cell-artistB_name="{ item }">
          <NuxtLink :to="`/artist/${item.artistB.slug}`" class="text-blue-400 hover:underline">
            {{ item.artistB.name }}
          </NuxtLink>
        </template>

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

        <template #cell-proposedValues="{ item }">
          <span v-if="item.proposedValues" class="text-xs text-green-500">
            {{ Object.keys(item.proposedValues).join(', ') }}
          </span>
          <span v-else class="text-xs text-zinc-600">manual</span>
        </template>

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

        <template #cell-_resync="{ item }">
          <UiRefreshButton
            v-if="item.missingFields?.includes('mbRelease') && item.artist"
            :only="[item.artist.name]"
          />
        </template>
      </IssuesIssueTable>
    </div>

    <div v-if="activeSubtab === 'fixed' && REVERTABLE_TYPES.includes(type)" class="rounded-lg border border-zinc-800 bg-zinc-950">
      <IssuesIssueTable
        :type="type"
        :columns="resolvedColumns"
        :items="issuesStore.resolvedItems[type] ?? []"
        :total="issuesStore.resolvedTotal[type] ?? 0"
        :page="issuesStore.resolvedPage[type] ?? 1"
        :page-size="PAGE_SIZE"
        :loading="issuesStore.resolvedLoading[type] ?? false"
        :selected="selectedResolved"
        @update:selected="selectedResolved = $event"
        @page="issuesStore.setResolvedPage(type, $event)"
      >
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

        <template #cell-previousValue="{ item }">
          <span class="text-xs text-amber-400">{{ getHistoryPreviousValue(item) }}</span>
        </template>

        <template #cell-appliedValue="{ item }">
          <span class="text-xs text-green-400">{{ getHistoryAppliedValue(item) }}</span>
        </template>

        <template #cell-track_filePath="{ item }">
          <span class="truncate text-xs text-zinc-500" :title="item.track?.filePath">
            {{ item.track?.filePath?.split('/').slice(-2).join('/') }}
          </span>
        </template>

        <template #cell-fixedAt="{ item }">
          <span class="text-xs text-zinc-500">{{ getHistoryDate(item) }}</span>
        </template>
      </IssuesIssueTable>
    </div>

    <IssuesSelectionBar
      v-if="type !== 'enrichment' && activeSubtab === 'detected'"
      :count="selected.size"
      :type="type"
      :loading="terminal.isRunning"
      @fix="fixSelected"
    />

    <IssuesRevertSelectionBar
      v-if="REVERTABLE_TYPES.includes(type) && activeSubtab === 'fixed'"
      :count="selectedResolved.size"
      :loading="terminal.isRunning"
      @revert="revertSelected"
    />
  </div>
</template>
