<script setup lang="ts">
import { Loader2, Clock } from 'lucide-vue-next'
import { ICON_STROKE_WIDTH, sw } from '~/helpers/ui'

defineProps<{
  decades: string[]
  selected: string[]
  loading: boolean
}>()

defineEmits<{
  toggle: [decade: string]
}>()
</script>

<template>
  <UiCard padding="sm" :icon="Clock" title="Decade DNA" subtitle="Compare your collection across decades">
    <p class="text-base leading-relaxed text-stone-100/60">
      Pick up to four decades to overlay. Every axis is normalised to the strongest decade in the library.
    </p>

    <div v-if="loading" class="flex items-center gap-2 text-base text-stone-100/60">
      <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
      Loading...
    </div>

    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="decade in decades"
        :key="decade"
        type="button"
        :class="sw('chip', selected.includes(decade))"
        @click="$emit('toggle', decade)"
      >
        {{ decade }}
      </button>
    </div>
  </UiCard>
</template>
