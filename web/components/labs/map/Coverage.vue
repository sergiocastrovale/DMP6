<script setup lang="ts">
import { Download } from 'lucide-vue-next'

defineProps<{
  artists: number
  countries: number
  exporting: boolean
}>()

defineEmits<{
  download: []
}>()
</script>

<template>
  <div class="absolute bottom-4 right-4 z-[1000] flex items-center gap-3">
    <span class="rounded-lg bg-stone-900/80 px-3 py-2 text-base text-stone-100/60 backdrop-blur">
      Showing <strong class="text-stone-100">{{ artists }}</strong> artists from <strong class="text-stone-100">{{ countries }}</strong> countries
    </span>
    <UiButton
      size="sm"
      variant="quiet"
      :icon="Download"
      :loading="exporting"
      title="Download the current view as a PNG"
      @click="$emit('download')"
    >
      Download PNG
    </UiButton>
  </div>
</template>
