<script setup lang="ts">
import type { Component } from 'vue'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

defineProps<{
  icon?: Component
  message: string
  hint?: string
}>()

defineSlots<{ action?: () => any }>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 py-10 text-center">
    <component :is="icon" v-if="icon" :size="32" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/20" />
    <div class="flex flex-col gap-1">
      <p class="text-base text-stone-100/40">{{ message }}</p>
      <p v-if="hint" class="text-sm text-stone-100/30">{{ hint }}</p>
    </div>
    <slot name="action" />
  </div>
</template>
