<script setup lang="ts">
import { SKELETON_GRID_SIZE } from '~/helpers/constants'
import { grid } from '~/helpers/ui'

defineProps<{
  title: string
  loading: boolean
  empty: boolean
}>()
</script>

<template>
  <div>
    <DashboardSectionHeader :title="title" />
    <!-- One grid definition for both states (not a separately-defined LoadingGrid) - a skeleton
         grid with different columns than the real one causes a layout shift the instant data
         arrives. -->
    <div v-if="loading" :class="grid.auto">
      <ReleaseSkeleton v-for="i in SKELETON_GRID_SIZE" :key="i" />
    </div>
    <div v-else-if="!empty" :class="grid.auto">
      <slot />
    </div>
  </div>
</template>
