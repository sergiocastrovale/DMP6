<script setup lang="ts">
import { ChevronLeft, ChevronRight, Info, Music, Play } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'
import { clampPage, formatDuration, pageCount, paginate } from '~/helpers/functions'
import { EXPLORE_HISTORY_PAGE_SIZE, EXPLORE_HISTORY_TV_LIMIT } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, surface, typography } from '~/helpers/ui'

const props = defineProps<{
  tracks: PlayerTrack[]
  tv?: boolean
}>()

const emit = defineEmits<{
  play: [track: PlayerTrack]
}>()

const { resolve: resolveImage } = useImageUrl()
const trackImage = (track: PlayerTrack) => resolveImage(track.releaseImage, track.releaseImageUrl, 'releases')

const page = ref(0)
const showInfoDialog = ref(false)
const infoTrack = ref<PlayerTrack | null>(null)
const infoRelease = ref<UnifiedRelease | null>(null)
const infoExtra = ref<ReleaseInfoExtra | null>(null)

watch(() => props.tracks.length, (length) => {
  page.value = clampPage(page.value, length, EXPLORE_HISTORY_PAGE_SIZE)
})

const totalPages = computed(() => pageCount(props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE))

// TV mode drops paging in favour of a short, always-current list - a paginated list doesn't read
// well blown up from a couch.
const visible = computed(() => props.tv
  ? props.tracks.slice(0, EXPLORE_HISTORY_TV_LIMIT)
  : paginate(props.tracks, page.value, EXPLORE_HISTORY_PAGE_SIZE))

const goOlder = () => {
  page.value = clampPage(page.value + 1, props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE)
}

const goNewer = () => {
  page.value = clampPage(page.value - 1, props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE)
}

async function openTrackInfo(track: PlayerTrack) {
  const localReleaseId = track.localReleaseId
  if (!localReleaseId) {
    return
  }
  infoTrack.value = track
  infoRelease.value = null
  infoExtra.value = null
  showInfoDialog.value = true
  try {
    const [release, extra] = await Promise.all([
      $fetch<UnifiedRelease>(`/api/releases/${localReleaseId}`),
      $fetch<ReleaseInfoExtra>(`/api/releases/${localReleaseId}/info`),
    ])
    infoRelease.value = release
    infoExtra.value = extra
  }
  catch { /* ignore */ }
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-2">
      <span :class="[typography.sectionLabel, tv && 'text-xl']">Previously Played</span>

      <div v-if="totalPages > 1 && !tv" class="flex items-center gap-1">
        <UiButton
          variant="ghost"
          size="sm"
          icon-only
          :icon="ChevronLeft"
          :disabled="page >= totalPages - 1"
          aria-label="Older tracks"
          @click="goOlder"
        />
        <UiButton
          variant="ghost"
          size="sm"
          icon-only
          :icon="ChevronRight"
          :disabled="page <= 0"
          aria-label="Newer tracks"
          @click="goNewer"
        />
      </div>
    </div>

    <div :class="[surface.card, 'flex flex-col divide-y divide-stone-100/6']">
      <div v-for="track in visible" :key="track.id" :class="cx('flex items-center gap-3', tv ? 'px-5 py-4' : 'px-3 py-2')">
        <button
          type="button"
          :class="cx('group/thumb relative shrink-0 cursor-pointer overflow-hidden rounded-md bg-stone-800', tv ? 'size-16' : 'size-9')"
          @click="emit('play', track)"
        >
          <img v-if="trackImage(track)" :src="trackImage(track)!" :alt="track.album" class="h-full w-full object-cover">
          <span v-else class="flex h-full w-full items-center justify-center text-stone-100/50">
            <Music :size="tv ? 22 : 14" :stroke-width="ICON_STROKE_WIDTH" />
          </span>
          <span class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100">
            <Play :size="tv ? 20 : 12" :stroke-width="ICON_STROKE_WIDTH" fill="currentColor" class="text-stone-100" />
          </span>
        </button>

        <div class="flex min-w-0 flex-1 flex-col">
          <span :class="cx('truncate font-medium text-stone-100', tv ? 'text-xl' : 'text-sm')">{{ track.title }}</span>
          <span :class="cx('truncate text-stone-100/55', tv ? 'text-base' : 'text-xs')">
            <NuxtLink
              v-if="track.artistSlug"
              :to="`/artist/${track.artistSlug}`"
              class="text-amber-400 hover:text-amber-300"
            >
              {{ track.artist }}
            </NuxtLink>
            <span v-else class="text-amber-400">{{ track.artist }}</span>
            <template v-if="track.year"> · {{ track.year }}</template>
          </span>
        </div>

        <span v-if="track.duration" :class="[typography.meta, 'shrink-0', tv && 'text-base']">
          {{ formatDuration(track.duration) }}
        </span>

        <button
          v-if="track.localReleaseId"
          type="button"
          :aria-label="`Release info for ${track.album}`"
          class="shrink-0 cursor-pointer rounded-full p-1.5 text-stone-100/50 transition-colors duration-150 hover:text-amber-400"
          @click="openTrackInfo(track)"
        >
          <Info :size="tv ? 20 : 14" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>
    </div>

    <ReleaseInfoDialog v-model="showInfoDialog" :release="infoRelease" :extra="infoExtra" />
  </div>
</template>
