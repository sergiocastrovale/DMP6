<script setup lang="ts">
import type { MosaicItem } from '~/types/labs'
import { formatMosaicSize } from '~/helpers/functions'
import { typography } from '~/helpers/ui'

defineProps<{
  url: string | null
  item: MosaicItem | null
  description: string
}>()

defineEmits<{
  open: []
}>()
</script>

<template>
  <UiCard padding="sm" title="Preview" class="sticky top-20">
    <button
      v-if="url"
      type="button"
      class="block w-full cursor-pointer overflow-hidden rounded-lg"
      title="Click to open full resolution"
      @click="$emit('open')"
    >
      <img
        :key="url"
        :src="url"
        alt="Mosaic preview"
        class="w-full transition-opacity duration-150 hover:opacity-90"
      >
    </button>
    <p v-else class="text-base text-stone-100/55">
      Click the view button on a mosaic to see its preview here.
    </p>

    <div v-if="url" class="mt-3 flex items-baseline justify-between gap-3">
      <span class="text-sm text-stone-100/55">{{ description }}</span>
      <span v-if="item" :class="typography.meta">
        <template v-if="item.imageCount">{{ item.imageCount.toLocaleString() }} covers · </template>{{ formatMosaicSize(item.size) }}
      </span>
    </div>
  </UiCard>
</template>
