<script setup lang="ts">
import { Disc3, SkipBack, SkipForward } from 'lucide-vue-next'
import { usePlayerStore } from '~/stores/player'
import { cx, ICON_STROKE_WIDTH, surface } from '~/helpers/ui'

const player = usePlayerStore()
const { resolve } = useImageUrl()

const albumCover = computed(() =>
  resolve(player.currentTrack?.releaseImage ?? null, player.currentTrack?.releaseImageUrl ?? null, 'releases'),
)

const releaseLink = computed(() => {
  const slug = player.currentTrack?.artistSlug
  if (!slug) {
    return null
  }
  const localReleaseId = player.currentTrack?.localReleaseId
  return { path: `/artist/${slug}`, query: localReleaseId ? { releaseId: localReleaseId } : undefined }
})

// Local, not useState: the trigger (this bar) and the sheet are direct parent/child in one
// subtree with one mount point, so nothing else needs to react to it. v-if (not v-show) mounts
// the sheet only while open - see MobileSheet.vue for why that's load-bearing, not stylistic.
const expanded = ref(false)
const expand = () => { expanded.value = true }
const collapse = () => { expanded.value = false }
</script>

<template>
  <div v-if="player.isVisible" :class="cx('fixed inset-x-0 bottom-[57px] z-40 lg:hidden', surface.playerBar)">
    <div class="relative flex h-16 items-center">
      <!-- Full-bleed tap target under the content layer, rather than a click-target guard on the
           row: a real <button> is focusable and gets aria-expanded for free, which a <div> with a
           closest()-based click handler would not (axe flags a non-interactive element used as
           one). Interactive children opt back in with pointer-events-auto below. -->
      <button
        type="button"
        class="absolute inset-0"
        aria-label="Expand player"
        :aria-expanded="expanded"
        aria-controls="player-sheet"
        @click="expand"
      />
      <div class="pointer-events-none relative flex w-full items-center gap-3 px-3">
        <NuxtLink
          v-if="releaseLink"
          :to="releaseLink"
          class="pointer-events-auto relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-md bg-stone-800 bg-cover bg-center"
          :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
          :aria-label="`Go to ${player.currentTrack?.album || player.currentTrack?.title || 'release'}`"
        >
          <Disc3 v-if="!albumCover" :size="18" class="text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
        </NuxtLink>
        <div
          v-else
          class="relative z-[1] flex size-11 shrink-0 items-center justify-center rounded-md bg-stone-800 bg-cover bg-center"
          :style="albumCover ? { backgroundImage: `url(${albumCover})` } : {}"
        >
          <Disc3 v-if="!albumCover" :size="18" class="text-stone-500" :stroke-width="ICON_STROKE_WIDTH" />
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-stone-100">
            {{ player.currentTrack?.title || 'No track' }}
          </p>
          <p class="truncate text-xs text-stone-100/55">
            {{ player.currentTrack?.artist }}
          </p>
        </div>

        <div class="pointer-events-auto flex items-center gap-1">
          <UiButton
            variant="ghost"
            icon-only
            :icon="SkipBack"
            aria-label="Previous track"
            @click="player.previous()"
          />
          <PlayerPlayPauseButton
            :playing="player.isPlaying"
            size="md"
            @click="player.togglePlay()"
          />
          <UiButton
            variant="ghost"
            icon-only
            :icon="SkipForward"
            aria-label="Next track"
            @click="player.next()"
          />
        </div>
      </div>
    </div>

    <PlayerMobileSheet v-if="expanded" @close="collapse" />
  </div>
</template>
