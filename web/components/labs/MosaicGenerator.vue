<script setup lang="ts">
import { Grid3x3, Loader2, Play, Square } from 'lucide-vue-next'
import { useMosaicStore } from '~/stores/mosaic'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const mode = defineModel<string>('mode', { required: true })

const mosaic = useMosaicStore()

const modeOptions = [
  { value: 'chronological', label: 'Chronological' },
  { value: 'gradient', label: 'Gradient' },
]

const progressPercent = computed(() => {
  if (!mosaic.progress) { return 0 }
  return Math.min(100, (mosaic.progress.current / Math.max(1, mosaic.progress.total)) * 100)
})
</script>

<template>
  <UiCard padding="sm" :icon="Grid3x3" title="Album Mosaic" subtitle="All your album covers in one image">
    <p class="text-base leading-relaxed text-stone-100/60">
      Generates a mosaic of every album cover in your library.
      Chronological sorts by release year. Gradient arranges covers by color temperature - cold tones top-left, warm tones bottom-right.
    </p>

    <LabsRadioGroup v-model="mode" :options="modeOptions" />

    <div>
      <UiButton v-if="!mosaic.isGenerating" :icon="Play" @click="mosaic.generate(mode)">
        Generate
      </UiButton>
      <UiButton v-else variant="danger" :icon="Square" @click="mosaic.cancel()">
        Cancel
      </UiButton>
    </div>

    <UiLoadingPanel
      v-if="mosaic.isGenerating && mosaic.progress"
      :label="`Building (${mosaic.progress.current}/${mosaic.progress.total} images processed)`"
      :percent="progressPercent"
    />

    <div v-if="mosaic.isGenerating && !mosaic.progress" class="flex items-center gap-2 text-base text-stone-100/60">
      <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
      Starting...
    </div>

    <p v-if="mosaic.error" class="text-sm text-danger">{{ mosaic.error }}</p>
  </UiCard>
</template>
