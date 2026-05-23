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
      <div v-if="viewMode === 'grid'" class="grid grid-cols-6 gap-x-5 gap-y-10 max-[1180px]:grid-cols-8 max-[920px]:grid-cols-6 max-[640px]:grid-cols-4">
        <slot />
      </div>

      <div v-else class="flex flex-col gap-4">
        <slot />
      </div>
    </template>
  </div>
</template>
