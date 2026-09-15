<script setup lang="ts">
import { ImagePlus, Loader2 } from 'lucide-vue-next'
import type { Artist } from '~/types/artist'
import { useImageUrl } from '~/composables/useImageUrl'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  artist: Artist
  type?: 'mobile' | 'desktop'
  canFetchPhoto?: boolean
  photoBusy?: boolean
}>()

const emit = defineEmits<{
  fetchPhoto: []
}>()

const { artistImage } = useImageUrl()
const image = computed(() => artistImage(props.artist))

const confirmOpen = ref(false)
const confirmFetch = () => {
  confirmOpen.value = false
  emit('fetchPhoto')
}
</script>

<template>
  <div v-if="type === 'mobile'">
    <div
      v-if="image"
      class="absolute inset-0 bg-cover bg-center"
      :style="{ backgroundImage: `url(${image})` }"
    />
    <div v-else class="absolute inset-0 bg-stone-800" />
    <div class="absolute inset-0 bg-black/88" />
  </div>
  <div v-else class="group/photo relative size-28 shrink-0 overflow-hidden rounded-xl border border-stone-100/6 bg-stone-800 sm:size-36">
    <img
      v-if="image"
      :src="image"
      :alt="artist.name"
      class="size-full object-cover"
    >
    <div v-else class="flex size-full items-center justify-center font-display text-4xl font-bold text-stone-100/20">
      {{ artist.name.charAt(0).toUpperCase() }}
    </div>

    <button
      v-if="canFetchPhoto && !image"
      type="button"
      aria-label="Find artist photo"
      :disabled="photoBusy"
      class="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/50 text-stone-100/80 opacity-0 transition-opacity duration-150 hover:text-stone-100 focus-visible:opacity-100 group-hover/photo:opacity-100"
      :class="{ 'opacity-100': photoBusy }"
      @click="confirmOpen = true"
    >
      <Loader2 v-if="photoBusy" :size="22" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
      <ImagePlus v-else :size="22" :stroke-width="ICON_STROKE_WIDTH" />
    </button>

    <Dialog v-model="confirmOpen" title="Find artist photo" size="md">
      <template #content>
        <div  class="text-base text-stone-100/70">
          <p>
            Attempt to fetch the artist image from Wikidata, Wikipedia or Fanart.tv?
          </p>
          <p>
            If successful, the image will be added to the library and shown here automatically.
          </p>
        </div>
      </template>
      <template #footer>
        <UiButton variant="ghost" size="sm" @click="confirmOpen = false">
          Cancel
        </UiButton>
        <UiButton size="sm" @click="confirmFetch">
          Fetch artist image
        </UiButton>
      </template>
    </Dialog>
  </div>
</template>
