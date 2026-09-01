<script setup lang="ts">
import type { Component } from 'vue'
import { cx, ICON_STROKE_WIDTH, toneBanner, type Tone } from '~/helpers/ui'

withDefaults(defineProps<{
  tone: Tone
  icon?: Component
  align?: 'start' | 'center'
}>(), {
  align: 'center',
})

defineSlots<{
  default?: () => any
  actions?: () => any
}>()
</script>

<template>
  <div :class="cx('flex gap-2 rounded-lg border px-4 py-2 text-base', align === 'start' ? 'items-start' : 'items-center', toneBanner[tone])">
    <component :is="icon" v-if="icon" :size="15" :stroke-width="ICON_STROKE_WIDTH" :class="align === 'start' && 'mt-0.5 shrink-0'" />
    <div class="flex-1"><slot /></div>
    <slot name="actions" />
  </div>
</template>
