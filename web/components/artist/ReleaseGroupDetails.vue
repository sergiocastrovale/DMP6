<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3, Download, DownloadCloud, Eye, FolderInput, Info, Layers, Loader2, RefreshCw, X } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { downloadStatusTone, statuses } from '~/helpers/constants'
import { canRedownload } from '~/helpers/artistPageLogic'
import { containmentContainerTitle } from '~/helpers/functions'
import { cx, ICON_STROKE_WIDTH, surface, toneBg } from '~/helpers/ui'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'

const props = withDefaults(defineProps<{
  release: UnifiedRelease
  expanded: boolean
  isFavorite: boolean
  slug: string
  selectedTrackId?: string | null
  subtitle?: string | null
  discLabel?: string | null
  isBoxSet?: boolean
  coArtists?: { name: string, slug: string }[]
  connectedArtistNames?: string[]
  trackCount?: number
  playCount?: number
  isAcquiring?: boolean
}>(), {
  selectedTrackId: null,
  subtitle: null,
  discLabel: null,
  isBoxSet: false,
  connectedArtistNames: () => [],
  isAcquiring: false,
})

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  redownload: []
  toggleFavorite: []
  refresh: []
  info: []
  cancel: []
  goToBundle: []
}>()

const { releaseImage } = useImageUrl()
const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId } = usePlayRelease()
const { isSearching, isDownloading, isEnriching, isAwaitingMerge, downloadFailed, isAbandoned, verifyDownload } = useReleaseDownloadState(() => props.release)
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()
const { hasPerm } = useAuth()
const canDownload = hasPerm('downloads.crud')
const canScan = hasPerm('sync.run')
const { merge: mergeNow, busyIds: mergeBusyIds } = useDownloadQueueActions()
const onMergeNow = () => mergeNow(props.release.downloadedReleaseId!)

// Deliberately no fall-back to bundleParentReleaseId: a gap noting that its recordings sit inside
// another release is not that release, so the container playing must not light this row up.
const releaseId = computed(() => props.release.localReleaseId || props.release.id)
const isCurrent = computed(() => isCurrentReleaseId(releaseId.value))
const isPlaying = computed(() => isReleasePlayingId(releaseId.value))
const hasPlayable = computed(() => !!props.release.localReleaseId || props.release.localTrackCount > 0)
// A gap whose recordings already sit inside a bigger local release says so - it stays a gap, so the
// badge is muted, never a status pill (scripts/sync/src/owned.rs).
const containmentNote = computed(() => containmentContainerTitle(props.release.statusReason) ? props.release.statusReason : null)
const coArtists = computed(() => props.coArtists ?? props.release.coArtists ?? [])
const displayTrackCount = computed(() => props.trackCount ?? props.release.trackCount)
const displayPlayCount = computed(() => props.playCount ?? props.release.totalPlayCount)
const playableClasses = computed(() => hasPlayable.value ? 'cursor-pointer' : 'ml-6')

const statusDescription = (status: string) => statuses.find(s => s.value === status)?.description ?? ''
// docs/sync_decisions.md: box sets in the catalogue reprinting this release's whole group - a pure
// catalogue fact, shown regardless of whether this artist owns a copy of the box.
const alsoPartOfLabel = computed(() =>
  (props.release.alsoPartOf ?? []).map(a => a.year ? `${a.title} (${a.year})` : a.title).join(', ') || null)
</script>

<template>
  <div
    :data-release-id="release.id"
    :class="cx('border-b border-dashed border-stone-100/10 last:border-b-0', release.status !== 'MISSING' && 'hover:bg-stone-800/30')"
  >
    <div
      class="group/edition flex items-stretch gap-3 pl-3 pr-1 lg:px-3"
      :class="playableClasses"
      @click="hasPlayable && emit('toggle')"
    >
      <div v-if="hasPlayable" class="hidden self-center md:block w-4">
        <component :is="expanded ? ChevronDown : ChevronRight" :size="14" :stroke-width="ICON_STROKE_WIDTH" />
      </div>

      <div
        class="group/cover relative my-3 size-15 shrink-0 self-center bg-stone-800"
        :class="hasPlayable && 'cursor-pointer'"
        @click.stop="hasPlayable && emit('play')"
      >
        <img
          v-if="releaseImage(release)"
          :src="releaseImage(release)!"
          :alt="release.title"
          class="size-full object-cover"
          loading="lazy"
        >
        <div v-else class="flex size-full items-center justify-center text-stone-100/50">
          <Disc3 :size="24" :stroke-width="ICON_STROKE_WIDTH" />
        </div>
        <div
          v-if="hasPlayable"
          class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors duration-150 group-hover/cover:bg-black/60"
        >
          <PlayerPlayPauseButton
            :playing="isPlaying"
            size="sm"
            :class="isPlaying || isCurrent ? 'text-amber-400' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 self-center ml-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-lg font-medium" :class="release.status === 'MISSING' ? 'text-stone-100/55' : 'text-stone-100'">
            {{ release.title }}
          </span>
          <span v-if="subtitle" class="shrink-0 rounded bg-stone-100/8 px-1.5 py-0.5 text-xs font-medium text-stone-100/60">{{ subtitle }}</span>
          <span v-if="discLabel" class="shrink-0 text-xs text-stone-100/40">{{ discLabel }}</span>
          <span v-if="isBoxSet" :class="cx('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium', toneBg.info)">Box Set</span>
          <ToggleFavorite
            v-if="release.localReleaseId || release.bundleParentReleaseId"
            class="hidden md:inline-flex"
            :size="16"
            :active="isFavorite"
            :label="release.localReleaseId ? 'Toggle favorite' : 'Favorite the release this is bundled in'"
            @toggle="emit('toggleFavorite')"
          />
          <button
            v-if="containmentNote && release.bundleParentReleaseId"
            type="button"
            class="flex shrink-0 items-center gap-1 truncate rounded bg-stone-100/8 px-1.5 py-0.5 text-xs font-medium text-stone-100/60 transition-colors duration-150 hover:bg-stone-100/15 hover:text-stone-100"
            :title="`${containmentNote} - this release itself is still missing`"
            @click.stop="emit('goToBundle')"
          >
            <Layers :size="10" :stroke-width="ICON_STROKE_WIDTH" />
            <span class="truncate">{{ containmentNote }}</span>
          </button>
          <span
            v-else-if="containmentNote"
            class="flex shrink-0 items-center gap-1 truncate rounded bg-stone-100/8 px-1.5 py-0.5 text-xs font-medium text-stone-100/60"
            :title="`${containmentNote} - this release itself is still missing`"
          >
            <Layers :size="10" :stroke-width="ICON_STROKE_WIDTH" />
            <span class="truncate">{{ containmentNote }}</span>
          </span>
        </div>
        <ArtistReleaseSubInfo
          :release="release"
          :track-count="displayTrackCount"
          :play-count="displayPlayCount"
          :also-part-of-label="alsoPartOfLabel"
          :co-artists="coArtists"
          :connected-artist-names="connectedArtistNames"
        />
      </div>

      <div class="hidden shrink-0 items-center justify-end md:flex">
        <Popover v-if="!(isSearching || isDownloading || isEnriching || isAwaitingMerge)" trigger="hover">
          <template #trigger>
            <ReleaseStatusBadge :status="release.status" />
          </template>
          <template #content>
            <div :class="cx(surface.popover, 'absolute right-0 top-full z-20 mt-1 w-64 p-3')">
              <p class="text-xs text-stone-100/60">{{ release.statusReason || statusDescription(release.status) }}</p>
            </div>
          </template>
        </Popover>

        <UiBadge
          v-else-if="isSearching"
          :tone="downloadStatusTone.SEARCHING"
          title="Searching Soulseek for a source..."
        >
          <Loader2 :size="12" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" /> Searching
        </UiBadge>

        <UiBadge
          v-else-if="isDownloading"
          :tone="downloadStatusTone.DOWNLOADING"
          title="Downloading from Soulseek..."
        >
          <Loader2 :size="12" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" /> Downloading
        </UiBadge>

        <UiBadge
          v-else-if="isEnriching"
          :tone="downloadStatusTone.ENRICHING"
          title="Tagging and organizing before merge"
        >
          <Loader2 :size="12" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" /> Enriching
        </UiBadge>

        <UiBadge
          v-else-if="isAwaitingMerge"
          :tone="downloadStatusTone.READY"
          title="Ready to merge - use the Merge action"
        >
          Ready to merge
        </UiBadge>
      </div>

      <div class="flex shrink-0 items-center justify-end gap-0.5 pr-0 pl-1 lg:px-3">
        <div class="hidden items-center gap-0.5 md:flex">
        <template v-if="canDownload">
        <DataTableAction
          v-if="isSearching || isDownloading || isEnriching"
          :icon="X"
          label="Cancel download and delete its files"
          @click.stop="emit('cancel')"
        />

        <template v-else-if="isAwaitingMerge">
          <DownloadsDownloadDisabledButton
            :icon="FolderInput"
            icon-class="text-success"
            :loading="mergeBusyIds.has(release.downloadedReleaseId ?? '')"
            label="Merge this release now"
            :reasons="downloadsStore.mergeBlockReasons"
            @click="onMergeNow"
          />
          <DataTableAction
            :icon="Eye"
            label="Review on the Downloads page"
            @click.stop="verifyDownload"
          />
        </template>

        <DownloadsDownloadDisabledButton
          v-else-if="release.status === 'MISSING' && downloadsStore.downloadsEnabled"
          :icon="Download"
          :loading="isAcquiring"
          :label="isAcquiring ? 'Requesting download…' : isAbandoned ? 'Given up after repeated failures - click to retry manually' : downloadFailed ? 'Previous download attempt failed - retry' : 'Download this release'"
          :reasons="downloadsStore.acquireBlockReasons"
          @click="emit('download')"
        />

        <DownloadsDownloadDisabledButton
          v-else-if="canRedownload(release, downloadsStore.downloadsEnabled)"
          :icon="DownloadCloud"
          :loading="isAcquiring"
          :label="isAcquiring ? 'Requesting download…' : 'Re-download this release'"
          :reasons="downloadsStore.acquireBlockReasons"
          @click="emit('redownload')"
        />
        </template>

        <DataTableAction
          v-if="canScan && release.localReleaseId"
          :icon="RefreshCw"
          label="Refresh this release"
          :disabled="terminal.isRunning"
          @click.stop="emit('refresh')"
        />
        </div>

        <DataTableAction
          :icon="Info"
          label="Release info"
          @click.stop="emit('info')"
        />
      </div>
    </div>

    <DownloadProgress
      v-if="isDownloading || isEnriching"
      :percent="release.downloadPercent ?? 0"
      :status="release.downloadState ?? undefined"
    />

    <ArtistReleaseGroupTracks
      v-if="expanded && hasPlayable"
      :release-id="release.localReleaseId || release.mbReleaseRowId || release.id"
      :selected-track-id="selectedTrackId"
    />
  </div>
</template>
