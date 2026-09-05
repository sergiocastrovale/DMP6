<script setup lang="ts">
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { IssueColumn, IssueType } from '~/types/issues'
import { cx, data, layout, typography } from '~/helpers/ui'

const props = defineProps<{ type: IssueType }>()

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const selected = ref<Set<string>>(new Set())
const selectedResolved = ref<Set<string>>(new Set())
const searchInput = ref('')
const awaitingTerminal = ref(false)

const REVERTABLE_TYPES: IssueType[] = ['corrupted', 'missing']

const activeSubtab = ref<'detected' | 'fixed'>('detected')

const subtabs = computed(() => [
  { key: 'detected', label: 'Detected', count: issuesStore.total[props.type] ?? 0, activeColor: 'border-info' },
  { key: 'fixed', label: 'Fixed', count: issuesStore.resolvedTotal[props.type] ?? 0, activeColor: 'border-success' },
])

onMounted(() => {
  issuesStore.fetchSummary()
  issuesStore.fetchType(props.type, true)
  if (REVERTABLE_TYPES.includes(props.type)) {
    issuesStore.fetchResolved(props.type, true)
  }
})

watch(searchInput, (q) => {
  issuesStore.setSearch(props.type, q)
})

async function fixSelected() {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  selected.value = new Set()
  await issuesStore.queueIds(props.type, ids)
  awaitingTerminal.value = true
  terminal.run('./fix', [`--${props.type}`], `fix`)
  terminal.open()
}

async function revertSelected(mode: 'undo' | 'undo-resolved') {
  const ids = [...selectedResolved.value]
  if (!ids.length) {
    return
  }
  selectedResolved.value = new Set()
  await issuesStore.queueRevert(props.type, ids, mode)
  awaitingTerminal.value = true
  terminal.run('./fix', ['--revert', `--${props.type}`, `--mode=${mode}`], `fix`)
  terminal.open()
}

watch(
  () => terminal.exitCode,
  (code) => {
    if (code === 0 && !terminal.isRunning && awaitingTerminal.value) {
      awaitingTerminal.value = false
      issuesStore.fetchType(props.type, true)
      issuesStore.fetchResolved(props.type, true)
      issuesStore.fetchSummary()
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
      { key: 'folder', label: 'Folder', sortable: false },
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
      { key: 'folder', label: 'Folder', sortable: false },
    ]
    case 'enrichment': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'localRelease.title', label: 'Release', sortable: true },
      { key: 'localRelease.year', label: 'Year', sortable: true, width: 'w-16' },
      { key: 'missingFields', label: 'Missing', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: '_resync', label: '', sortable: false, width: 'w-24' },
    ]
    case 'duplicate-release': return [
      { key: 'releaseA.title', label: 'Release A', sortable: false },
      { key: 'releaseA.trackCount', label: 'A Tracks', sortable: false, width: 'w-20' },
      { key: 'releaseB.title', label: 'Release B', sortable: false },
      { key: 'releaseB.trackCount', label: 'B Tracks', sortable: false, width: 'w-20' },
    ]
    case 'mismatched-release-id': return [
      { key: 'releaseA.title', label: 'Release A', sortable: false },
      { key: 'releaseB.title', label: 'Release B', sortable: false },
      { key: 'releaseA.release.title', label: 'Shared MB Title', sortable: false },
    ]
    default: return []
  }
})

const resolvedColumns = computed<IssueColumn[]>(() => {
  switch (props.type) {
    case 'corrupted': return [
      { key: 'artist.name', label: 'Artist', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    case 'missing': return [
      { key: 'track.title', label: 'Title', sortable: false },
      { key: 'previousValue', label: 'Previous', sortable: false },
      { key: 'appliedValue', label: 'Applied', sortable: false },
      { key: 'folder', label: 'Folder', sortable: false },
      { key: 'fixedAt', label: 'Fixed At', sortable: false, width: 'w-28' },
    ]
    default: return []
  }
})

const typeLabels: Record<IssueType, string> = {
  corrupted: 'Corrupted TPE2',
  orphans: 'Orphan Artists',
  duplicates: 'Duplicate Artists',
  missing: 'Missing Metadata',
  enrichment: 'Enrichment Gaps',
  'duplicate-release': 'Duplicate Releases',
  'mismatched-release-id': 'Mismatched Release ID',
}

const typeDescriptions: Record<IssueType, { detection: string; fix: string }> = {
  corrupted: {
    detection: 'Tracks where the album artist tag (TPE2) contains numeric garbage, bitrate markers, or file path fragments instead of an actual artist name.',
    fix: 'Rewrites the TPE2 tag in the original audio file with the proposed value, then requires a re-index to update the database.',
  },
  orphans: {
    detection: 'Artists with no linked releases or tracks - either phantom entries with corrupted names (numeric/bitrate garbage) or fully disconnected records.',
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
    fix: 'Enrichment gaps are resolved by re-syncing with MusicBrainz or running external analysis tools. No automatic fix available - use the re-sync button where applicable.',
  },
  'duplicate-release': {
    detection: 'Local release pairs pointing at the same MusicBrainz release with matching title, track count, and duration - likely the same edition ripped into two different folders.',
    fix: 'No automatic fix - review and manually delete the redundant folder copy.',
  },
  'mismatched-release-id': {
    detection: 'Local release pairs pointing at the same MusicBrainz release despite having different titles - a sync-matcher bug linking unrelated albums to the same release row.',
    fix: 'No automatic fix - requires re-running the sync matcher, not a mechanical database edit.',
  },
}

async function onEdit(id: string, key: string, value: unknown) {
  await issuesStore.patchIssue(props.type, id, { [key]: value })
}

function getFolderPath(item: any): string {
  const fp = item.track?.filePath || item.folderPath || ''
  if (!fp) {
    return '-'
  }
  const parts = fp.split('/')
  return parts.slice(0, -1).join('/')
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString()
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getHistoryPreviousEntries(item: any): { key: string; value: string }[] {
  const history = item.fixHistory?.[0]
  if (!history) {
    return []
  }
  const prev = history.previousState as Record<string, unknown>
  const appliedKeys = Object.keys((history.appliedState as Record<string, unknown>) ?? {})
  return Object.entries(prev)
    .filter(([k, v]) => v != null && v !== '' && appliedKeys.includes(k))
    .map(([k, v]) => ({ key: k, value: String(v) }))
}

function getHistoryAppliedEntries(item: any): { key: string; value: string }[] {
  const history = item.fixHistory?.[0]
  if (!history) {
    return []
  }
  const state = history.appliedState as Record<string, unknown>
  return Object.entries(state)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ({ key: k, value: String(v) }))
}

function getHistoryDate(item: any): string {
  const history = item.fixHistory?.[0]
  return history ? formatDateTime(history.appliedAt) : '-'
}
</script>

<template>
  <div :class="cx(layout.page)">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
        <h1 :class="typography.h3">{{ typeLabels[type] }}</h1>
        <div class="flex items-center gap-2">
        <SearchInput
          v-model="searchInput"
          placeholder="Search..."
          :debounce="350"
        />
      </div>
      </div>
      <p class="text-base text-stone-100/55">
        {{ typeDescriptions[type].detection }}
        <span class="text-stone-100/25">Fix:</span> {{ typeDescriptions[type].fix }}
      </p>
    </div>

    <Subtabs v-if="REVERTABLE_TYPES.includes(type)" v-model="activeSubtab" :tabs="subtabs" />

    <IssuesSelectionBar
      v-if="type !== 'enrichment' && type !== 'duplicate-release' && type !== 'mismatched-release-id' && activeSubtab === 'detected'"
      :count="selected.size"
      :type="type"
      :loading="terminal.isRunning"
      @fix="fixSelected"
      @cancel="selected = new Set()"
    />

    <IssuesRevertSelectionBar
      v-if="REVERTABLE_TYPES.includes(type) && activeSubtab === 'fixed'"
      :count="selectedResolved.size"
      :loading="terminal.isRunning"
      @revert="revertSelected"
      @cancel="selectedResolved = new Set()"
    />

    <div v-if="activeSubtab === 'detected'">
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
            class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
          >
            {{ item.artist.name }}
          </NuxtLink>
          <span v-else class="text-stone-100/20">-</span>
        </template>

        <template #cell-confidence="{ item }">
          <IssuesConfidenceBadge :confidence="item.confidence" />
        </template>

        <template #cell-folder="{ item }">
          <span class="truncate text-xs text-stone-100/55" :title="getFolderPath(item)">
            {{ getFolderPath(item) }}
          </span>
        </template>

        <template #cell-proposedParts="{ item }">
          <div class="flex flex-wrap gap-1">
            <span
              v-for="part in item.proposedParts"
              :key="part"
              :class="data.tag"
            >{{ part }}</span>
          </div>
        </template>

        <template #cell-reason="{ item }">
          <span :class="data.tag">{{ item.reason }}</span>
        </template>

        <template #cell-artist_createdAt="{ item }">
          <span class="text-xs text-stone-100/55">{{ formatDate(item.artist.createdAt) }}</span>
        </template>

        <template #cell-artist_musicbrainzId="{ item }">
          <span :class="item.artist.musicbrainzId ? 'text-success' : 'text-stone-100/25'">
            {{ item.artist.musicbrainzId ? 'Yes' : 'No' }}
          </span>
        </template>

        <template #cell-artistA_name="{ item }">
          <NuxtLink :to="`/artist/${item.artistA.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
            {{ item.artistA.name }}
          </NuxtLink>
        </template>

        <template #cell-artistB_name="{ item }">
          <NuxtLink :to="`/artist/${item.artistB.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
            {{ item.artistB.name }}
          </NuxtLink>
        </template>

        <template #cell-releaseA_title="{ item }">
          <NuxtLink
            v-if="item.releaseA.artist"
            :to="`/artist/${item.releaseA.artist.slug}`"
            class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
            :title="item.releaseA.folderPath"
          >
            {{ item.releaseA.title }}
          </NuxtLink>
          <span v-else class="truncate text-stone-100/55" :title="item.releaseA.folderPath">{{ item.releaseA.title }}</span>
        </template>

        <template #cell-releaseB_title="{ item }">
          <NuxtLink
            v-if="item.releaseB.artist"
            :to="`/artist/${item.releaseB.artist.slug}`"
            class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
            :title="item.releaseB.folderPath"
          >
            {{ item.releaseB.title }}
          </NuxtLink>
          <span v-else class="truncate text-stone-100/55" :title="item.releaseB.folderPath">{{ item.releaseB.title }}</span>
        </template>

        <template #cell-releaseA_trackCount="{ item }">
          <span class="text-xs text-stone-100/55 tabular-nums">{{ item.releaseA.trackCount }}</span>
        </template>

        <template #cell-releaseB_trackCount="{ item }">
          <span class="text-xs text-stone-100/55 tabular-nums">{{ item.releaseB.trackCount }}</span>
        </template>

        <template #cell-releaseA_release_title="{ item }">
          <span class="text-xs text-stone-100/60">{{ item.releaseA.release?.title ?? '-' }}</span>
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
                class="inline-flex items-center rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger"
              >{{ f }}</span>
            </template>
          </div>
        </template>

        <template #cell-proposedValues="{ item }">
          <span v-if="item.proposedValues" class="text-xs text-success">
            {{ Object.keys(item.proposedValues).join(', ') }}
          </span>
          <span v-else class="text-xs text-stone-100/25">manual</span>
        </template>

        <template #cell-localRelease_title="{ item }">
          <NuxtLink
            v-if="item.localRelease"
            :to="`/artist/${item.artist?.slug}`"
            class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
          >
            {{ item.localRelease.title }}
          </NuxtLink>
          <span v-else class="text-stone-100/20">-</span>
        </template>

        <template #cell-_resync="{ item }">
          <UiButtonRefresh
            v-if="item.missingFields?.includes('mbRelease') && item.artist"
            :only="[item.artist.name]"
            :folders="item.localRelease?.folderPath ? [item.localRelease.folderPath] : undefined"
          />
        </template>
      </IssuesIssueTable>
    </div>

    <div v-if="activeSubtab === 'fixed' && REVERTABLE_TYPES.includes(type)">
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
            class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
          >
            {{ item.artist.name }}
          </NuxtLink>
          <span v-else class="text-stone-100/20">-</span>
        </template>

        <template #cell-previousValue="{ item }">
          <div class="flex flex-col gap-0.5">
            <span v-for="e in getHistoryPreviousEntries(item)" :key="e.key" class="text-xs text-accent">
              <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
            </span>
            <span v-if="!getHistoryPreviousEntries(item).length" class="text-xs text-stone-100/20">-</span>
          </div>
        </template>

        <template #cell-appliedValue="{ item }">
          <div class="flex flex-col gap-0.5">
            <span v-for="e in getHistoryAppliedEntries(item)" :key="e.key" class="text-xs text-success">
              <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
            </span>
            <span v-if="!getHistoryAppliedEntries(item).length" class="text-xs text-stone-100/20">-</span>
          </div>
        </template>

        <template #cell-folder="{ item }">
          <span class="truncate text-xs text-stone-100/55" :title="getFolderPath(item)">
            {{ getFolderPath(item) }}
          </span>
        </template>

        <template #cell-fixedAt="{ item }">
          <span class="text-xs text-stone-100/55">{{ getHistoryDate(item) }}</span>
        </template>
      </IssuesIssueTable>
    </div>

  </div>
</template>
