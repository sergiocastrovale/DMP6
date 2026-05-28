<script setup lang="ts">
import { ChevronDown, ChevronRight, Download, FolderClosed, Heart, Info, Link, Pause, Play, RefreshCw } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import type { TrackListColumn } from '~/types/ui'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import { statuses } from '~/helpers/constants'

const props = defineProps<{
  edition: UnifiedRelease
  expanded: boolean
  isFavorite: boolean
  slug: string
}>()

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  toggleFavorite: []
  refresh: []
  info: []
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
</script>

<template>
  <div
    :data-release-id="edition.id"
    class="border-b border-rule last:border-b-0"
    :class="edition.status === 'MISSING' ? '' : 'hover:bg-bg-2/30'"
  >
    <div
      class="group/edition flex cursor-pointer items-center gap-3 px-3 py-2.5"
      @click="emit('toggle')"
    >
      <button
        type="button"
        class="flex size-5 items-center justify-center text-ink0"
        @click.stop="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>

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
          <Pause v-if="isPlaying" :size="12" fill="currentColor" class="text-accent" />
          <Play
            v-else
            :size="12"
            fill="currentColor"
            :class="isCurrent ? 'text-accent' : 'text-ink-2 group-hover/folder:text-ink'"
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

      <button
        v-if="edition.status === 'MISSING' && downloadsStore.anyConfigured"
        type="button"
        class="rounded-full p-1.5 text-ink0 transition-colors hover:text-accent"
        title="Download this release"
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

    <div v-if="expanded && hasPlayable" class="border-t border-rule px-3 pb-3" @click.stop>
      <ReleaseTracksTable
        :release-id="edition.localReleaseId || edition.mbReleaseRowId || edition.id"
        :columns="releaseTrackColumns"
      />
    </div>
  </div>
</template>
