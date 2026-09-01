<script setup lang="ts">
import type { Component } from 'vue'
import { cx, ICON_STROKE_WIDTH, surface, typography } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  padding?: 'sm' | 'md' | 'lg'
  title?: string
  subtitle?: string
  icon?: Component
  gap?: boolean
}>(), {
  padding: 'md',
  gap: true,
})

const PADDING: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

defineSlots<{
  default?: () => any
  header?: () => any
  actions?: () => any
}>()
</script>

<template>
  <div :class="cx(surface.card, PADDING[props.padding], gap && 'flex flex-col gap-5')">
    <div v-if="title || icon || $slots.header || $slots.actions" class="flex items-center gap-3">
      <slot name="header">
        <div v-if="icon" class="flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
          <component :is="icon" :size="20" :stroke-width="ICON_STROKE_WIDTH" class="text-amber-400" />
        </div>
        <div v-if="title">
          <h2 v-if="icon || subtitle" class="text-lg font-semibold text-stone-100">{{ title }}</h2>
          <h2 v-else :class="typography.sectionLabel">{{ title }}</h2>
          <p v-if="subtitle" class="text-sm text-stone-100/55">{{ subtitle }}</p>
        </div>
      </slot>
      <div class="flex-1" />
      <slot name="actions" />
    </div>
    <slot />
  </div>
</template>
