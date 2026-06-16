<script setup lang="ts">
import { ChevronDown, ChevronRight, Download, FolderClosed, Heart, Info, Link, Loader2, PackageCheck, RefreshCw, X } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import type { TrackListColumn } from '~/types/ui'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'
import { downloadSubpage } from '~/helpers/functions'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'

const props = defineProps<{
  edition: UnifiedRelease
  expanded: boolean
  isFavorite: boolean
  slug: string
  selectedTrackId?: string | null
}>()

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  toggleFavorite: []
  refresh: []
  info: []
  cancel: []
}>()

const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()

const releaseTrackColumns: TrackListColumn[] = [
  { key: 'trackNumber', label: '#' },
  { key: 'title', label: 'Title' },
  { key: 'playCount', label: 'Plays' },
  { key: 'duration' },
  { key: 'favorite' },
]

const getReleaseId = computed(() => props.edition.localReleaseId || props.edition.id)
const isCurrent = computed(() => isCurrentReleaseId(getReleaseId.value))
const isPlaying = computed(() => isReleasePlayingId(getReleaseId.value))
const hasPlayable = computed(() => !!props.edition.localReleaseId || props.edition.localTrackCount > 0)

const editionDisplayTitle = computed(() => props.edition.disambiguation || props.edition.editionLabel || 'Original release')

const statusDescription = (status: string) => statuses.find(s => s.value === status)?.description ?? ''

// Acquisition pipeline state (see docs/feature_monitoring.md)
const isDownloading = computed(() => props.edition.downloadState === 'DOWNLOADING')
const isEnriching = computed(() => props.edition.downloadState === 'ENRICHING')
const isDownloaded = computed(() => props.edition.downloadState === 'READY')
const downloadFailed = computed(() => props.edition.downloadState === 'FAILED')
const isAbandoned = computed(() => props.edition.downloadState === 'ABANDONED')
const verifyDownload = () => navigateTo(`${downloadSubpage(props.edition.downloadState)}?highlight=${props.edition.downloadedReleaseId}`)
</script>

<template>
  <div
    :data-release-id="edition.id"
    class="border-b border-rule last:border-b-0"
    :class="edition.status === 'MISSING' ? '' : 'hover:bg-bg-2/30'"
  >
    <div
      class="group/edition flex items-center gap-3 px-3 py-2.5"
      :class="hasPlayable ? 'cursor-pointer' : ''"
      @click="hasPlayable && emit('toggle')"
    >
      <button
        v-if="hasPlayable"
        type="button"
        class="flex size-5 items-center justify-center text-ink0"
        @click.stop="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>
      <div v-else class="size-5" />

      <div
        class="group/folder relative flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded border border-rule text-ink0 transition-colors"
        :class="isCurrent ? 'border-accent/50 text-accent' : 'hover:border-ink-3'"
        @click.stop="hasPlayable && emit('play')"
      >
        <FolderClosed :size="14" />
        <div
          v-if="hasPlayable"
          class="absolute inset-0 flex items-center justify-center bg-bg-1/70 transition-colors group-hover/folder:bg-bg-1/95"
        >
          <PlayerPlayPauseButton
            :playing="isPlaying"
            size="sm"
            class="!size-8 group-hover/folder:bg-accent group-hover/folder:text-accent-ink group-hover/folder:scale-105"
            :class="isPlaying || isCurrent ? 'text-accent' : 'text-ink-2 group-hover/folder:text-ink'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2 text-sm">
          <span class="truncate" :class="edition.status === 'MISSING' ? 'text-ink0' : 'text-ink'">
            {{ editionDisplayTitle }}
          </span>
          <span v-if="edition.year" class="text-xs">({{ edition.year }})</span>
        </div>
        <div class="text-xs" :class="edition.status === 'MISSING' ? 'text-ink-4' : 'text-ink0'">
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
          <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
            <p class="text-xs text-ink-2">{{ edition.statusReason || statusDescription(edition.status) }}</p>
          </div>
        </template>
      </Popover>

      <span
        v-if="isDownloading"
        class="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-400"
        title="dmp is downloading this release from Soulseek"
      >
        <Loader2 :size="12" class="animate-spin" /> Downloading
      </span>

      <button
        v-if="isDownloading || isEnriching"
        type="button"
        class="rounded-full p-1.5 text-ink0 transition-colors hover:text-red-400"
        title="Cancel download and delete its files"
        @click.stop="emit('cancel')"
      >
        <X :size="14" />
      </button>

      <button
        v-else-if="isDownloaded"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/20"
        title="Downloaded - verify and merge it on the Downloads page"
        @click.stop="verifyDownload"
      >
        <PackageCheck :size="12" /> Verify download
      </button>

      <button
        v-else-if="edition.status === 'MISSING' && downloadsStore.slskd.connected"
        type="button"
        class="rounded-full p-1.5 transition-colors hover:text-accent"
        :class="downloadFailed ? 'text-red-400' : isAbandoned ? 'text-ink-4' : 'text-ink0'"
        :title="isAbandoned ? 'Given up after repeated failures - click to retry manually' : downloadFailed ? 'Previous download attempt failed - retry' : 'Download this release'"
        @click.stop="emit('download')"
      >
        <Download :size="14" />
      </button>

      <button
        v-if="edition.localReleaseId"
        type="button"
        class="rounded-full p-1.5 text-ink0 transition-colors hover:text-accent"
        :class="{ 'text-accent': isFavorite }"
        @click.stop="emit('toggleFavorite')"
      >
        <Heart :size="14" :fill="isFavorite ? 'currentColor' : 'none'" />
      </button>

      <a
        v-if="edition.musicbrainzId"
        :href="`https://musicbrainz.org/release/${edition.musicbrainzId}`"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-full p-1.5 text-ink-4 transition-colors hover:text-ink-2"
        title="View on MusicBrainz"
        @click.stop
      >
        <Link :size="14" />
      </a>

      <button
        v-if="edition.localReleaseId"
        type="button"
        class="rounded-full p-1.5 text-ink-4 transition-colors hover:text-ink-2"
        title="Refresh this release"
        :disabled="terminal.isRunning"
        @click.stop="emit('refresh')"
      >
        <RefreshCw :size="14" />
      </button>

      <button
        type="button"
        class="rounded-full p-1.5 text-ink-4 transition-colors hover:text-ink-2"
        title="Release info"
        @click.stop="emit('info')"
      >
        <Info :size="14" />
      </button>
    </div>

    <DownloadProgress
      v-if="edition.downloadState === 'DOWNLOADING' || edition.downloadState === 'ENRICHING'"
      :percent="edition.downloadPercent ?? 0"
      :status="edition.downloadState"
    />

    <div v-if="expanded && hasPlayable" class="border-t border-rule px-3 pb-3" @click.stop>
      <ReleaseTracksTable
        :release-id="edition.localReleaseId || edition.mbReleaseRowId || edition.id"
        :columns="releaseTrackColumns"
        :selected-track-id="selectedTrackId"
      />
    </div>
  </div>
</template>
