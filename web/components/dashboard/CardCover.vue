<script setup lang="ts">
import { Play, Pause } from 'lucide-vue-next'
import type { Release } from '~/types/release'

const props = defineProps<{ release: Release }>()

const { releaseImage } = useImageUrl()
const { toggleOrPlay, isReleasePlaying } = usePlayRelease()

const coverUrl = computed(() => releaseImage(props.release))
const isPlaying = computed(() => isReleasePlaying(props.release.id))

const handlePlay = (e: Event) => {
  e.stopPropagation()
  toggleOrPlay(props.release.id, props.release.artist?.slug)
}
</script>

<template>
  <div class="aspect-square relative overflow-hidden rounded-cover bg-bg-2 cursor-pointer" @click="handlePlay">
    <img
      v-if="coverUrl"
      :src="coverUrl"
      :alt="release.title"
      class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
    />
    <div
      class="absolute right-3 bottom-3 w-11 h-11 rounded-full bg-accent text-accent-ink grid place-items-center shadow-play transition-all duration-200"
      :class="isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'"
    >
      <Pause v-if="isPlaying" :size="16" fill="currentColor" />
      <Play v-else :size="16" fill="currentColor" />
    </div>
  </div>  
</template>