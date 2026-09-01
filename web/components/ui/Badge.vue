<script setup lang="ts">
import type { Component } from 'vue'
import { cx, ICON_STROKE_WIDTH, toneBg, type Tone } from '~/helpers/ui'

withDefaults(defineProps<{
  tone?: Tone
  size?: 'sm' | 'md'
  icon?: Component
}>(), {
  tone: 'muted',
  size: 'sm',
})

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'rounded-full px-2 py-0.5 text-xs font-medium',
  md: 'rounded-full px-2.5 py-1 text-sm font-semibold',
}
</script>

<template>
  <span :class="cx('inline-flex items-center gap-1', SIZE[size], toneBg[tone])">
    <component :is="icon" v-if="icon" :size="12" :stroke-width="ICON_STROKE_WIDTH" />
    <slot />
  </span>
</template>
