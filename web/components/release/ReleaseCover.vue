<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import Initial from '~/components/artist/Initial.vue'

const { isStreamMode } = useStreamMode()

const props = defineProps<{
  image: string | null
  imageUrl: string | null
  title: string
  size?: 'sm' | 'md' | 'lg'
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
  <div :class="sizeClass" class="group relative shrink-0 overflow-hidden rounded-lg bg-zinc-800">
    <img
      v-if="imgUrl"
      :src="imgUrl"
      :alt="title"
      class="size-full object-cover"
      loading="lazy"
    />
    <div v-else class="flex size-full items-center justify-center text-lg font-bold text-zinc-600">
      <Initial :name="title" />
    </div>
    <button
      v-if="!isStreamMode"
      class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
      @click="emit('play')"
    >
      <Play :size="24" class="text-zinc-50" />
    </button>
  </div>
</template>
