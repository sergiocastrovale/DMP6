<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3, Download, GitMerge, Heart, Info, Link, Loader2, RefreshCw, X } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'

const props = withDefaults(defineProps<{
  release: UnifiedRelease
  expanded: boolean
  isFavorite: boolean
  slug: string
  selectedTrackId?: string | null
  subtitle?: string | null
  coArtists?: { name: string; slug: string }[]
  connectedArtistNames?: string[]
  trackCount?: number
  playCount?: number
}>(), {
  selectedTrackId: null,
  subtitle: null,
  connectedArtistNames: () => [],
})

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  toggleFavorite: []
  refresh: []
  info: []
  cancel: []
}>()

const { releaseImage } = useImageUrl()
const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId } = usePlayRelease()
const { isDownloading, isEnriching, isAwaitingMerge, downloadFailed, isAbandoned, verifyDownload } = useReleaseDownloadState(() => props.release)
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()

const releaseId = computed(() => props.release.localReleaseId || props.release.id)
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
    class="border-b border-dashed border-white/10 last:border-b-0"
    :class="release.status === 'MISSING' ? '' : 'hover:bg-bg-2/30'"
  >
    <div
      class="group/edition flex items-stretch gap-3 px-3"
      :class="hasPlayable ? 'cursor-pointer' : ''"
      @click="hasPlayable && emit('toggle')"
    >
      <button
        v-if="hasPlayable"
        type="button"
        class="flex size-5 shrink-0 items-center justify-center self-center text-ink-2"
        @click.stop="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>
      <div v-else class="size-5 self-center" />

      <div
        class="group/cover relative my-3 size-15 shrink-0 self-center bg-bg-2"
        :class="hasPlayable ? 'cursor-pointer' : ''"
        @click.stop="hasPlayable && emit('play')"
      >
        <img
          v-if="releaseImage(release)"
          :src="releaseImage(release)!"
          :alt="release.title"
          class="size-full object-cover"
          loading="lazy"
        />
        <div v-else class="flex size-full items-center justify-center text-ink-4">
          <Disc3 :size="24" />
        </div>
        <div
          v-if="hasPlayable"
          class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover/cover:bg-black/60"
        >
          <PlayerPlayPauseButton
            :playing="isPlaying"
            size="sm"
            class="group-hover/cover:bg-accent group-hover/cover:text-accent-ink group-hover/cover:scale-105"
            :class="isPlaying || isCurrent ? 'text-accent' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 self-center ml-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-lg font-medium" :class="release.status === 'MISSING' ? 'text-ink0' : 'text-ink'">
            {{ release.title }}
          </span>
          <span v-if="subtitle" class="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">{{ subtitle }}</span>
        </div>
        <div class="mt-0.5 flex items-center gap-3 text-xs text-ink-2">
          <span v-if="release.type">{{ release.type }}</span>
          <span v-if="release.year">{{ release.year }}</span>
          <span v-if="displayTrackCount">{{ displayTrackCount }} tracks</span>
          <span v-if="coArtists.length" class="text-ink-1">Feat.
            <template v-for="(co, i) in coArtists" :key="co.slug">
              <NuxtLink
                :to="`/artist/${co.slug}`"
                class="text-ink-2 transition-colors hover:text-accent"
                @click.stop
              >{{ co.name }}</NuxtLink><template v-if="i < coArtists.length - 1">, </template>
            </template>
          </span>
          <span v-if="connectedArtistNames.length" class="flex items-center gap-1 text-ink-1 italic" :title="`Originally credited to: ${connectedArtistNames.join(', ')}`">
            <Info :size="12" />
            <span>as {{ connectedArtistNames.join(', ') }}</span>
          </span>
          <span v-if="displayPlayCount">· {{ displayPlayCount.toLocaleString() }} plays</span>
        </div>
      </div>

      <div class="flex w-24 shrink-0 items-center justify-center">
        <Popover v-if="!(isDownloading || isEnriching || isAwaitingMerge)" trigger="hover">
          <template #trigger>
            <ReleaseStatusBadge :status="release.status" />
          </template>
          <template #content>
            <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
              <p class="text-xs text-ink-2">{{ release.statusReason || statusDescription(release.status) }}</p>
            </div>
          </template>
        </Popover>
      </div>

      <div class="flex w-32 shrink-0 items-center justify-end gap-0.5 px-3">
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
          class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-red-400 cursor-pointer"
          title="Cancel download and delete its files"
          @click.stop="emit('cancel')"
        >
          <X :size="14" />
        </button>

        <button
          v-else-if="isAwaitingMerge"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/20 cursor-pointer"
          title="Awaiting merge - review & merge on the Downloads page"
          @click.stop="verifyDownload"
        >
          <GitMerge :size="12" /> Awaiting merge
        </button>

        <button
          v-else-if="release.status === 'MISSING' && downloadsStore.sourceEnabled"
          type="button"
          class="rounded-full p-1.5 transition-colors hover:text-accent cursor-pointer"
          :class="downloadFailed ? 'text-red-400' : isAbandoned ? 'text-ink-4' : 'text-ink-3'"
          :title="isAbandoned ? 'Given up after repeated failures - click to retry manually' : downloadFailed ? 'Previous download attempt failed - retry' : 'Download this release'"
          @click.stop="emit('download')"
        >
          <Download :size="14" />
        </button>

        <button
          v-if="release.localReleaseId"
          type="button"
          class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
          :class="{ 'text-accent': isFavorite }"
          title="Toggle favorite"
          @click.stop="emit('toggleFavorite')"
        >
          <Heart :size="14" :fill="isFavorite ? 'currentColor' : 'none'" />
        </button>

        <a
          v-if="release.musicbrainzId"
          :href="`https://musicbrainz.org/release/${release.musicbrainzId}`"
          target="_blank"
          rel="noopener noreferrer"
          class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
          title="View on MusicBrainz"
          @click.stop
        >
          <Link :size="14" />
        </a>

        <button
          v-if="release.localReleaseId"
          type="button"
          class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
          title="Refresh this release"
          :disabled="terminal.isRunning"
          @click.stop="emit('refresh')"
        >
          <RefreshCw :size="14" />
        </button>

        <button
          type="button"
          class="rounded-full p-1.5 text-ink-3 transition-colors hover:text-accent cursor-pointer"
          title="Release info"
          @click.stop="emit('info')"
        >
          <Info :size="14" />
        </button>
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
