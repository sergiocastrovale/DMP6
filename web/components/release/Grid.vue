<template>
  <div
    v-if="loading || hasReleases"
    class="flex flex-col gap-8"
  >
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-zinc-50">
        {{ title }}
      </h2>
      <NuxtLink
        v-if="viewMoreLink"
        :to="viewMoreLink"
        class="text-sm text-amber-500 hover:text-amber-600 transition-colors"
      >
        View all
      </NuxtLink>
    </div>
    <LoadingGrid
      v-if="loading"
      :count="SKELETON_GRID_SIZE"
    />
    <div
      v-else-if="hasReleases"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    >
      <ReleaseBlock
        v-for="release in releases"
        :key="release.id"
        :release="release"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'

const hasReleases = computed(() => props.releases.length > 0)

const props = withDefaults(defineProps<{
  title: string
  releases: Release[]
  viewMoreLink?: string
  loading?: boolean
}>(), {
  viewMoreLink: undefined,
  loading: false,
})
</script>
