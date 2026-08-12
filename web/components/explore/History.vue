<script setup lang="ts">
import { ChevronLeft, ChevronRight, Clock, Play } from 'lucide-vue-next'
import type { PlayerTrack } from '~/types/player'
import { clampPage, formatDuration, pageCount, paginate } from '~/helpers/functions'
import { EXPLORE_HISTORY_PAGE_SIZE } from '~/helpers/constants'

const props = defineProps<{
  tracks: PlayerTrack[]
}>()

const emit = defineEmits<{
  play: [track: PlayerTrack]
}>()

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
      <div class="flex items-center gap-2 text-sm font-medium text-ink-2">
        <Clock :size="14" />
        Session History
      </div>

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

    <div class="flex flex-col divide-y divide-rule/50 rounded-xl border border-rule bg-bg-1/50">
      <button
        v-for="track in visible"
        :key="track.id"
        class="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-2/50"
        @click="emit('play', track)"
      >
        <Play :size="14" class="shrink-0 text-ink0" />
        <span class="min-w-0 flex-1 truncate text-sm text-ink-2">
          {{ track.title }}
          <span class="text-ink0"> - {{ track.artist }}</span>
        </span>
        <span v-if="track.duration" class="shrink-0 text-xs tabular-nums text-ink-4">
          {{ formatDuration(track.duration) }}
        </span>
      </button>
    </div>
  </div>
</template>
