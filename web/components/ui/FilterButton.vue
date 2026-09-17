<script setup lang="ts">
import { SlidersHorizontal, X } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH, sw } from '~/helpers/ui'

defineProps<{
  activeCount: number
}>()

const emit = defineEmits<{
  clear: []
}>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <button type="button" :class="cx(sw('chip', activeCount > 0), 'gap-2')" @click="open = true">
    <SlidersHorizontal :size="14" :stroke-width="ICON_STROKE_WIDTH" />
    Filters
    <span v-if="activeCount" :class="sw('countPill', true)">{{ activeCount }}</span>
  </button>
  <button v-if="activeCount" type="button" :class="cx(sw('chip', false), 'gap-1')" @click="emit('clear')">
    <X :size="14" :stroke-width="ICON_STROKE_WIDTH" />
    Clear filters
  </button>
</template>
