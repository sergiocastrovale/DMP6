<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3, Download, DownloadCloud, Eye, FolderInput, Info, Layers, Loader2, RefreshCw, X } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { downloadStatusTone, statuses } from '~/helpers/constants'
import { canRedownload } from '~/helpers/artistPageLogic'
import { cx, ICON_STROKE_WIDTH, surface } from '~/helpers/ui'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'

const props = withDefaults(defineProps<{
  release: UnifiedRelease
  expanded: boolean
  isFavorite: boolean
  slug: string
  selectedTrackId?: string | null
  subtitle?: string | null
  coArtists?: { name: string, slug: string }[]
  connectedArtistNames?: string[]
  trackCount?: number
  playCount?: number
  isAcquiring?: boolean
}>(), {
  selectedTrackId: null,
  subtitle: null,
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
const { merge: mergeNow, busyIds: mergeBusyIds } = useDownloadQueueActions()
const onMergeNow = () => mergeNow(props.release.downloadedReleaseId!)

const releaseId = computed(() => props.release.localReleaseId || props.release.bundleParentReleaseId || props.release.id)
const isCurrent = computed(() => isCurrentReleaseId(releaseId.value))
const isPlaying = computed(() => isReleasePlayingId(releaseId.value))
const hasPlayable = computed(() => !!props.release.localReleaseId || props.release.localTrackCount > 0)
const coArtists = computed(() => props.coArtists ?? props.release.coArtists ?? [])
const displayTrackCount = computed(() => props.trackCount ?? props.release.trackCount)
const displayPlayCount = computed(() => props.playCount ?? props.release.totalPlayCount)

const statusDescription = (status: string) => statuses.find(s => s.value === status)?.description ?? ''
</script>

<template>
  <div
    :data-release-id="release.id"
    :class="cx('border-b border-dashed border-stone-100/10 last:border-b-0', release.status !== 'MISSING' && 'hover:bg-stone-800/30')"
  >
    <div
      class="group/edition flex items-stretch gap-3 px-3"
      :class="hasPlayable && 'cursor-pointer'"
      @click="hasPlayable && emit('toggle')"
    >
      <UiButton
        v-if="hasPlayable"
        variant="ghost"
        size="sm"
        icon-only
        :icon="expanded ? ChevronDown : ChevronRight"
        class="self-center"
        @click.stop="emit('toggle')"
      />
      <div v-else class="size-5 self-center" />

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
            class="group-hover/cover:bg-amber-400 group-hover/cover:text-on-accent group-hover/cover:scale-105"
            :class="isPlaying || isCurrent ? 'text-amber-400' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 self-center ml-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-lg font-medium" :class="release.status === 'MISSING' ? 'text-stone-100/55' : 'text-stone-100'">
            {{ release.title }}
          </span>
          <span v-if="subtitle" class="shrink-0 rounded bg-stone-100/8 px-1.5 py-0.5 text-2xs font-medium text-stone-100/60">{{ subtitle }}</span>
          <ToggleFavorite
            v-if="release.localReleaseId || release.bundleParentReleaseId"
            :size="16"
            :active="isFavorite"
            :label="release.localReleaseId ? 'Toggle favorite' : 'Favorite the release this is bundled in'"
            @toggle="emit('toggleFavorite')"
          />
          <button
            v-if="release.bundleParentReleaseId"
            type="button"
            class="flex shrink-0 items-center gap-1 truncate rounded bg-amber-400/10 px-1.5 py-0.5 text-2xs font-medium text-amber-400 transition-colors duration-150 hover:bg-amber-400/20"
            :title="release.statusReason || 'View the release this is bundled in'"
            @click.stop="emit('goToBundle')"
          >
            <Layers :size="10" :stroke-width="ICON_STROKE_WIDTH" />
            <span class="truncate">{{ release.statusReason || 'Owned as part of another release' }}</span>
          </button>
        </div>
        <div class="mt-0.5 flex items-center gap-3 text-xs text-stone-100/60">
          <span v-if="release.type">{{ release.type }}</span>
          <span v-if="release.year">{{ release.year }}</span>
          <span v-if="displayTrackCount">{{ displayTrackCount }} tracks</span>
          <span v-if="coArtists.length">Feat.
            <template v-for="(co, i) in coArtists" :key="co.slug">
              <NuxtLink
                :to="`/artist/${co.slug}`"
                class="text-stone-100/60 transition-colors duration-150 hover:text-amber-400"
                @click.stop
              >{{ co.name }}</NuxtLink><template v-if="i < coArtists.length - 1">, </template>
            </template>
          </span>
          <span v-if="connectedArtistNames.length" class="flex items-center gap-1 italic" :title="`Originally credited to: ${connectedArtistNames.join(', ')}`">
            <Info :size="12" :stroke-width="ICON_STROKE_WIDTH" />
            <span>as {{ connectedArtistNames.join(', ') }}</span>
          </span>
          <span v-if="displayPlayCount">· {{ displayPlayCount.toLocaleString() }} plays</span>
        </div>
      </div>

      <div class="flex w-24 shrink-0 items-center justify-center">
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
          title="Searching Soulseek/RuTracker for a source..."
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

      <div class="flex w-32 shrink-0 items-center justify-end gap-0.5 px-3">
        <DataTableAction
          v-if="isSearching || isDownloading || isEnriching"
          :icon="X"
          label="Cancel download and delete its files"
          @click.stop="emit('cancel')"
        />

        <template v-else-if="isAwaitingMerge">
          <DataTableAction
            variant="success"
            :icon="FolderInput"
            :loading="mergeBusyIds.has(release.downloadedReleaseId ?? '')"
            label="Merge this release now"
            @click.stop="onMergeNow"
          />
          <DataTableAction
            :icon="Eye"
            label="Review on the Downloads page"
            @click.stop="verifyDownload"
          />
        </template>

        <DataTableAction
          v-else-if="release.status === 'MISSING' && downloadsStore.sourceEnabled"
          :icon="Download"
          :loading="isAcquiring"
          :label="isAcquiring ? 'Requesting download…' : isAbandoned ? 'Given up after repeated failures - click to retry manually' : downloadFailed ? 'Previous download attempt failed - retry' : 'Download this release'"
          @click.stop="emit('download')"
        />

        <DataTableAction
          v-else-if="canRedownload(release, downloadsStore.sourceEnabled)"
          :icon="DownloadCloud"
          :loading="isAcquiring"
          :label="isAcquiring ? 'Requesting download…' : 'Re-download this release'"
          @click.stop="emit('redownload')"
        />

        <!-- Intentionally not shown for bundle-owned sub-releases (bundleParentReleaseId set, no
             localReleaseId): there's no separate folder to re-scan, the parent row's own Refresh
             already covers those files. -->
        <DataTableAction
          v-if="release.localReleaseId"
          :icon="RefreshCw"
          label="Refresh this release"
          :disabled="terminal.isRunning"
          @click.stop="emit('refresh')"
        />

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
