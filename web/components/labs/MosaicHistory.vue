<script setup lang="ts">
import { Download, Eye, Trash2 } from 'lucide-vue-next'
import type { MosaicItem } from '~/types/labs'
import { formatDate, formatMosaicSize } from '~/helpers/functions'

defineProps<{
  items: MosaicItem[]
}>()

defineEmits<{
  view: [item: MosaicItem]
  download: [filename: string]
  delete: [filename: string]
}>()
</script>

<template>
  <UiCard padding="sm" title="Mosaic History">
    <UiEmptyState v-if="items.length === 0" message="No mosaics generated yet." />

    <div v-else class="divide-y divide-stone-100/10 rounded-lg border border-stone-100/6">
      <div
        v-for="item in items"
        :key="item.filename"
        class="flex items-center justify-between px-4 py-3"
      >
        <div>
          <p class="text-base text-stone-100">{{ formatDate(item.createdAt) }}</p>
          <p class="text-sm text-stone-100/55">
            <span v-if="item.imageCount">{{ item.imageCount }} covers · </span>{{ formatMosaicSize(item.size) }}
          </p>
        </div>
        <div class="flex items-center gap-1">
          <UiButton
            variant="ghost"
            size="sm"
            icon-only
            :icon="Eye"
            aria-label="View preview"
            @click="$emit('view', item)"
          />
          <UiButton
            variant="ghost"
            size="sm"
            icon-only
            :icon="Download"
            aria-label="Download full resolution"
            @click="$emit('download', item.filename)"
          />
          <UiButton
            variant="ghost"
            size="sm"
            icon-only
            :icon="Trash2"
            aria-label="Delete"
            class="hover:text-danger"
            @click="$emit('delete', item.filename)"
          />
        </div>
      </div>
    </div>
  </UiCard>
</template>
