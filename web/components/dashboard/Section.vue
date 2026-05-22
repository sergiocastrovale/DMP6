<script setup lang="ts">
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

defineProps<{
  title: string
  loading: boolean
  empty: boolean
  viewMode: 'grid' | 'list'
}>()
</script>

<template>
  <div>
    <DashboardSectionHeader :title="title" />
    <LoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />
    <template v-else-if="!empty">
      <div v-if="viewMode === 'grid'" class="grid grid-cols-5 gap-x-8 gap-y-10 max-[1180px]:grid-cols-4 max-[920px]:grid-cols-3 max-[640px]:grid-cols-2">
        <slot />
      </div>

      <div v-else class="flex flex-col gap-4">
        <slot />
      </div>
    </template>
  </div>
</template>
