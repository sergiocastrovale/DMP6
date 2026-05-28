<script setup lang="ts">
import Initial from '~/components/artist/Initial.vue'

const props = defineProps<{
  image: string | null
  imageUrl: string | null
  title: string
  size?: 'sm' | 'md' | 'lg'
  playing?: boolean
}>()

const emit = defineEmits<{ play: [] }>()

const { releaseImage } = useImageUrl()
const imgUrl = computed(() => releaseImage(props))

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'size-24'
    case 'lg': return 'size-48'
    default: return 'size-32'
  }
})
</script>

<template>
  <div :class="sizeClass" class="group relative shrink-0 overflow-hidden rounded-lg bg-bg-2">
    <img
      v-if="imgUrl"
      :src="imgUrl"
      :alt="title"
      class="size-full object-cover"
      loading="lazy"
    />
    <div v-else class="flex size-full items-center justify-center text-lg font-bold text-ink-4">
      <Initial :name="title" />
    </div>
    <div
      class="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity"
      :class="playing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      @click="emit('play')"
    >
      <PlayerPlayPauseButton :playing="playing" size="lg" class="text-white group-hover:bg-accent group-hover:text-accent-ink group-hover:scale-105" />
    </div>
  </div>
</template>
