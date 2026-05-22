<script setup lang="ts">
import { Play, Pause } from 'lucide-vue-next'
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()

const { releaseImage } = useImageUrl()
const { toggleOrPlay, isReleasePlaying } = usePlayRelease()

const coverUrl = computed(() => releaseImage(props.release))
const isPlaying = computed(() => isReleasePlaying(props.release.id))

const handlePlay = () => {
  toggleOrPlay(props.release.id, props.release.artist?.slug)
}
</script>

<template>
  <div
    class="flex items-center gap-4 px-3 py-2.5 border-b border-rule hover:bg-bg-1 transition-colors cursor-pointer group"
    @click="handlePlay"
  >
    <div class="relative size-[52px] shrink-0 overflow-hidden rounded-cover bg-bg-2">
      <img
        v-if="coverUrl"
        :src="coverUrl"
        :alt="release.title"
        class="w-full h-full object-cover"
      />
      <div
        class="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity"
        :class="isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      >
        <Pause v-if="isPlaying" :size="16" class="text-ink" fill="currentColor" />
        <Play v-else :size="16" class="text-ink" fill="currentColor" />
      </div>
    </div>

    <div class="flex-1 min-w-0">
      <div class="font-semibold text-sm text-ink truncate">{{ release.title }}</div>
      <NuxtLink
        v-if="release.artist"
        :to="`/artist/${release.artist.slug}`"
        class="text-card-artist text-ink-2 truncate hover:text-ink transition-colors block"
        @click.stop
      >
        {{ release.artist.name }}
      </NuxtLink>
    </div>

    <div class="flex gap-6 items-center font-mono text-meta-lg text-ink-3 tracking-[0.04em] shrink-0">
      <span v-if="release.year">{{ release.year }}</span>
      <span v-if="release.genre" class="uppercase max-w-[150px] truncate">{{ release.genre }}</span>
    </div>
  </div>
</template>
