<script setup lang="ts">
import type { Component } from 'vue'
import { ICON_STROKE_WIDTH, typography } from '~/helpers/ui'

defineProps<{
  text: string
  subtext?: string
  icon?: Component
  // Hides the icon/text (e.g. Explore's TV mode) while keeping the wrapper and slot mounted, so
  // a slotted control (the fullscreen toggle) never remounts and loses focus when the text does.
  hideText?: boolean
}>()
</script>

<template>
  <div class="flex items-center justify-between">
    <div v-if="!hideText" class="flex items-center gap-3">
      <component :is="icon" v-if="icon" :size="24" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 text-amber-400" />
      <div>
        <h1 :class="typography.h1">{{ text }}</h1>
        <p v-if="subtext" class="mt-0.5 text-sm text-stone-100/55">{{ subtext }}</p>
      </div>
    </div>
    <slot />
  </div>
</template>
