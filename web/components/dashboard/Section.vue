<script setup lang="ts">
import { SKELETON_GRID_SIZE } from '~/helpers/constants'
import { grid, typography } from '~/helpers/ui'

defineProps<{
  title: string
  loading: boolean
  empty: boolean
}>()
</script>

<template>
  <div>
    <h2 :class="typography.h2" class="mt-6 mb-4 pb-1 border-b border-stone-700">
      {{ title }}
    </h2>

    <div v-if="loading" :class="grid.auto">
      <ReleaseSkeleton v-for="i in SKELETON_GRID_SIZE" :key="i" />
    </div>
    <div v-else-if="!empty" :class="grid.auto">
      <slot />
    </div>
  </div>
</template>
