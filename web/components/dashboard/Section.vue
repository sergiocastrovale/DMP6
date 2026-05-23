<script setup lang="ts">
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

defineProps<{
  title: string
  loading: boolean
  empty: boolean
}>()
</script>

<template>
  <div>
    <DashboardSectionHeader :title="title" />
    <LoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />

    <div v-else-if="!empty" class="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(130px,200px))] xl:grid-cols-[repeat(auto-fill,minmax(130px,220px))]">
      <slot />
    </div>
  </div>
</template>
