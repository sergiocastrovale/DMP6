<script setup lang="ts">
import { ChevronLeft, ChevronRight, Info, Music, Play } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { clampPage, formatDuration, pageCount, paginate } from '~/helpers/functions'
import { EXPLORE_HISTORY_PAGE_SIZE } from '~/helpers/constants'
import { ICON_STROKE_WIDTH, typography } from '~/helpers/ui'

const props = defineProps<{
  tracks: PlayerTrack[]
}>()

const emit = defineEmits<{
  play: [track: PlayerTrack]
}>()

const { resolve: resolveImage } = useImageUrl()
const trackImage = (track: PlayerTrack) => resolveImage(track.releaseImage, track.releaseImageUrl, 'releases')

const page = ref(0)

watch(() => props.tracks.length, (length) => {
  page.value = clampPage(page.value, length, EXPLORE_HISTORY_PAGE_SIZE)
})

const totalPages = computed(() => pageCount(props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE))

const visible = computed(() => paginate(props.tracks, page.value, EXPLORE_HISTORY_PAGE_SIZE))

const goOlder = () => {
  page.value = clampPage(page.value + 1, props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE)
}

const goNewer = () => {
  page.value = clampPage(page.value - 1, props.tracks.length, EXPLORE_HISTORY_PAGE_SIZE)
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-2">
      <span :class="typography.sectionLabel">Previously Played</span>

      <div v-if="totalPages > 1" class="flex items-center gap-1">
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

    <div class="flex flex-col divide-y divide-stone-100/6 rounded-xl border border-stone-100/6 bg-stone-900/50">
      <div v-for="track in visible" :key="track.id" class="group flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left"
          @click="emit('play', track)"
        >
          <span class="relative size-9 shrink-0 overflow-hidden rounded-md bg-stone-800">
            <img v-if="trackImage(track)" :src="trackImage(track)!" :alt="track.album" class="h-full w-full object-cover">
            <span v-else class="flex h-full w-full items-center justify-center text-stone-100/30">
              <Music :size="14" :stroke-width="ICON_STROKE_WIDTH" />
            </span>
            <span class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Play :size="12" :stroke-width="ICON_STROKE_WIDTH" fill="currentColor" class="text-stone-100" />
            </span>
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-medium text-stone-100">{{ track.title }}</span>
            <span class="truncate text-xs text-stone-100/40">
              <span class="text-amber-400">{{ track.artist }}</span><template v-if="track.year"> · {{ track.year }}</template>
            </span>
          </span>
        </button>

        <span v-if="track.duration" :class="[typography.meta, 'shrink-0']">
          {{ formatDuration(track.duration) }}
        </span>

        <NuxtLink
          v-if="track.artistSlug"
          :to="`/artist/${track.artistSlug}`"
          :aria-label="`Go to ${track.artist}`"
          class="shrink-0 rounded-full p-1.5 text-stone-100/30 transition-colors duration-150 hover:text-amber-400"
        >
          <Info :size="14" :stroke-width="ICON_STROKE_WIDTH" />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
