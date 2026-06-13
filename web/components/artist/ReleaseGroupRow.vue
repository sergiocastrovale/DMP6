<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3, Download, Info, Link, Loader2, PackageCheck, RefreshCw } from 'lucide-vue-next'
import type { ReleaseGroup } from '~/types/release'
import { useDownloadsStore } from '~/stores/downloads'
import { useTerminalStore } from '~/stores/terminal'
import DownloadProgress from '~/components/downloads/DownloadProgress.vue'

const props = withDefaults(defineProps<{
  group: ReleaseGroup
  expanded: boolean
  slug: string
  singleEdition?: boolean
}>(), {
  singleEdition: false,
})

const emit = defineEmits<{
  toggle: []
  play: []
  download: []
  refresh: []
  info: []
}>()

const { releaseImage } = useImageUrl()
const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId } = usePlayRelease()
const downloadsStore = useDownloadsStore()
const terminal = useTerminalStore()

const getReleaseId = (r: typeof props.group.primary) => r.localReleaseId || r.id
const edition = computed(() => props.group.primary)

// Acquisition pipeline state (see docs/feature_monitoring.md)
const isDownloading = computed(() => edition.value.downloadState === 'DOWNLOADING')
const isEnriching = computed(() => edition.value.downloadState === 'ENRICHING')
const isDownloaded = computed(() => edition.value.downloadState === 'PENDING' || edition.value.downloadState === 'APPROVED')
const downloadFailed = computed(() => edition.value.downloadState === 'FAILED')
const isAbandoned = computed(() => edition.value.downloadState === 'ABANDONED')
const verifyDownload = () => navigateTo(`/downloads?highlight=${edition.value.downloadedReleaseId}`)

const connectedArtistNames = computed(() => {
  const names = new Set(props.group.releases.map(r => r.connectedArtistName).filter(Boolean) as string[])
  return [...names]
})
const isGroupCurrent = computed(() => props.group.releases.some(r => isCurrentReleaseId(getReleaseId(r))))
const isGroupPlaying = computed(() => props.group.releases.some(r => isReleasePlayingId(getReleaseId(r))))
const hasPlayable = computed(() => props.group.releases.some(r => r.localReleaseId || r.localTrackCount > 0))
</script>

<template>
  <div
    :data-group-key="group.key"
    class="border-b border-rule transition-colors last:border-b-0"
    :class="group.primary.status === 'MISSING' ? 'bg-red-500/3' : 'hover:bg-bg-2/50'"
  >
    <div
      class="group flex items-stretch gap-3 px-3"
      :class="hasPlayable ? 'cursor-pointer' : ''"
      @click="hasPlayable && emit('toggle')"
    >
      <button
        v-if="hasPlayable"
        type="button"
        class="flex size-5 shrink-0 items-center justify-center self-center text-ink0"
        @click.stop="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>
      <div v-else class="size-5 self-center" />

      <div
        class="group/cover relative my-3 size-15 shrink-0 cursor-pointer self-center bg-bg-2"
        @click.stop="hasPlayable && emit('play')"
      >
        <img
          v-if="releaseImage(group.primary)"
          :src="releaseImage(group.primary)!"
          :alt="group.primary.title"
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
            :playing="isGroupPlaying"
            size="sm"
            class="group-hover/cover:bg-accent group-hover/cover:text-accent-ink group-hover/cover:scale-105"
            :class="isGroupPlaying || isGroupCurrent ? 'text-accent' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 self-center ml-1">
        <div class="flex items-baseline gap-2 text-sm">
          <span class="truncate text-lg font-medium" :class="group.primary.status === 'MISSING' ? 'text-ink0' : 'text-ink'">
            {{ group.primary.title }}
          </span>
          <span
            v-if="group.releases.length > 1"
            class="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
          >{{ group.releases.length }} editions</span>
        </div>
        <div class="mt-0.5 flex items-center gap-3 text-xs text-ink-2">
          <span v-if="group.primary.type">{{ group.primary.type }}</span>
          <span v-if="group.primary.year">{{ group.primary.year }}</span>
          <span v-if="group.totalTracks">{{ group.totalTracks }} tracks</span>
          <span v-if="group.primary.coArtists?.length" class="text-ink-1">Feat.
            <template v-for="(co, i) in group.primary.coArtists" :key="co.slug">
              <NuxtLink
                :to="`/artist/${co.slug}`"
                class="text-ink-2 transition-colors hover:text-accent"
                @click.stop
              >{{ co.name }}</NuxtLink><template v-if="i < group.primary.coArtists!.length - 1">, </template>
            </template>
          </span>
          <span v-if="connectedArtistNames.length" class="flex items-center gap-1 text-ink-1 italic" :title="`Originally credited to: ${connectedArtistNames.join(', ')}`">
            <Info :size="12" />
            <span>as {{ connectedArtistNames.join(', ') }}</span>
          </span>
          <span v-if="group.totalPlayCount">· {{ group.totalPlayCount.toLocaleString() }} plays</span>
        </div>
      </div>

      <div class="flex w-24 shrink-0 items-center justify-center">
        <ReleaseStatusMulti :releases="group.releases" />
      </div>

      <div class="flex w-32 shrink-0 items-center justify-end gap-0.5 px-3">
        <template v-if="singleEdition">
          <span
            v-if="isDownloading"
            class="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-400"
            title="dmp is downloading this release from Soulseek"
          >
            <Loader2 :size="12" class="animate-spin" /> Downloading
          </span>

          <button
            v-else-if="isDownloaded"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/20 cursor-pointer"
            title="Downloaded - verify and approve it on the Downloads page"
            @click.stop="verifyDownload"
          >
            <PackageCheck :size="12" /> Verify download
          </button>

          <button
            v-else-if="edition.status === 'MISSING' && downloadsStore.slskd.connected"
            type="button"
            class="rounded-full p-1.5 transition-colors hover:text-accent cursor-pointer"
            :class="downloadFailed ? 'text-red-400' : isAbandoned ? 'text-ink-4' : 'text-ink'"
            :title="isAbandoned ? 'Given up after repeated failures - click to retry manually' : downloadFailed ? 'Previous download attempt failed - retry' : 'Download this release'"
            @click.stop="emit('download')"
          >
            <Download :size="14" />
          </button>

          <a
            v-if="edition.musicbrainzId"
            :href="`https://musicbrainz.org/release/${edition.musicbrainzId}`"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-full p-1.5 text-ink transition-colors hover:text-accent cursor-pointer"
            title="View on MusicBrainz"
            @click.stop
          >
            <Link :size="14" />
          </a>

          <button
            v-if="edition.localReleaseId"
            type="button"
            class="rounded-full p-1.5 text-ink transition-colors hover:text-accent cursor-pointer"
            title="Refresh this release"
            :disabled="terminal.isRunning"
            @click.stop="emit('refresh')"
          >
            <RefreshCw :size="14" />
          </button>

          <button
            type="button"
            class="rounded-full p-1.5 text-ink transition-colors hover:text-accent cursor-pointer"
            title="Release info"
            @click.stop="emit('info')"
          >
            <Info :size="14" />
          </button>
        </template>
      </div>
    </div>

    <DownloadProgress
      v-if="isDownloading || isEnriching"
      :percent="edition.downloadPercent ?? 0"
      :status="edition.downloadState ?? undefined"
    />

    <div v-if="expanded" @click.stop>
      <div class="ml-8 border-l-2 border-rule">
        <slot />
      </div>
    </div>
  </div>
</template>
